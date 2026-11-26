import { gomoku } from '@wmg/rules';
import {
  fail,
  LobbyMatch,
  OK,
  type HandleResult,
  type LobbyIO,
  type LobbyMember,
  type NewView,
  type ReplaceReason,
} from '../../framework/game/LobbyMatch.js';
import type { Rng } from '../../framework/rng.js';
import type { Scheduler } from '../../framework/scheduler.js';
import type { Timing } from '../liars-dice/LiarsDiceMatch.js';
import { GomokuPlayerState, GomokuState } from './state.js';

export type { HandleResult, JoinResult } from '../../framework/game/LobbyMatch.js';

type Options = gomoku.GomokuRoomOptions;
type Color = gomoku.GomokuColor;
type ServerMessages = gomoku.GomokuServerMessages;
type ServerMessageType = gomoku.GomokuServerMessageType;
type Phase = gomoku.GomokuPhase;

export const GOMOKU_SPECTATOR_LIMIT = 20;

/** 엔진 → 네트워크. 방 어댑터(GomokuRoom)가 구현한다 */
export interface GomokuIO extends LobbyIO {
  broadcast<T extends ServerMessageType>(type: T, payload: ServerMessages[T]): void;
  sendTo<T extends ServerMessageType>(playerId: string, type: T, payload: ServerMessages[T]): void;
  /** 판이 끝났다 (기록용). 수 순서와 결과 */
  onFinished?(record: GomokuRecord): void;
}

export interface GomokuRecord {
  readonly gameId: string;
  readonly roomCode: string;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly options: Options;
  readonly players: readonly {
    readonly playerId: string;
    readonly guestId: string | null;
    readonly nickname: string;
    readonly color: Color;
    readonly isBot: boolean;
    readonly replaced: boolean;
  }[];
  readonly moves: readonly {
    readonly color: Color;
    readonly x: number;
    readonly y: number;
    readonly isBot: boolean;
  }[];
  readonly result: gomoku.GomokuResult;
  readonly winnerColor: Color | null;
}

export interface GomokuDeps {
  readonly io: GomokuIO;
  readonly rng: Rng;
  readonly scheduler: Scheduler;
  readonly timing: Timing;
}

interface Member extends LobbyMember<GomokuPlayerState> {
  color: Color | null;
}

/**
 * 오목 한 방의 진행 (docs/specs/gomoku.md). 대기실·좌석·이탈·리매치는 LobbyMatch(ADR 0003)가 하고,
 * 여기서는 흑백 정하기, 착수, 금수, 시간패, 봇, 판 기록만 다룬다.
 */
export class GomokuMatch extends LobbyMatch<Options, GomokuPlayerState, Member, GomokuState, GomokuIO> {
  #board: gomoku.Cell[] = gomoku.emptyBoard();
  #moves: { color: Color; x: number; y: number; isBot: boolean }[] = [];
  #gameId = '';
  #startedAt = new Date(0);
  #turnColor: Color = 'black';
  #turnId = '';

  constructor(roomCode: string, options: Options, deps: GomokuDeps) {
    super(new GomokuState(), roomCode, options, deps);
    this.writeOptions();
    for (let i = 0; i < gomoku.GOMOKU_CELLS; i += 1) this.state.board.push(gomoku.EMPTY);
    this.updateListing();
  }

  override get phase(): Phase {
    return this.state.phase as Phase;
  }

  // ───────────────────────── 대기실 훅 ─────────────────────────

  protected maxSeats(): number {
    return gomoku.GOMOKU_PLAYERS;
  }

  protected spectatorLimit(): number {
    return GOMOKU_SPECTATOR_LIMIT;
  }

  protected createView(init: NewView): GomokuPlayerState {
    return new GomokuPlayerState({ ...init });
  }

  protected createMember(base: LobbyMember<GomokuPlayerState>): Member {
    return { ...base, color: null };
  }

  protected parseOptions(input: unknown): { ok: true; options: Options } | { ok: false } {
    return gomoku.parseGomokuOptions(input, this.opts);
  }

  protected writeOptions(): void {
    const o = this.state.options;
    const v = this.opts;
    o.blackPolicy = v.blackPolicy;
    o.forbidDoubleThree = v.forbidDoubleThree;
    o.forbidDoubleFour = v.forbidDoubleFour;
    o.forbidOverline = v.forbidOverline;
    o.turnSeconds = v.turnSeconds;
    o.fillWithBots = v.fillWithBots;
    o.isPrivate = v.isPrivate;
  }

  protected isPlaying(): boolean {
    return this.phase === 'PLAYING';
  }

  protected isGameOver(): boolean {
    return this.phase === 'GAME_OVER';
  }

  protected notifyReplaced(m: Member, reason: ReplaceReason): void {
    this.io.broadcast('player_replaced', { playerId: m.id, nickname: m.nickname, reason });
  }

  /** G-22: 게임 중 나가면 봇이 이어서 두고, 상대에게 알린다 */
  protected onSeatTakenOver(m: Member): void {
    m.view.replaced = true;
    this.notifyReplaced(m, 'left');
    if (this.phase === 'PLAYING' && m.color === this.#turnColor) this.#scheduleBot(this.#turnId);
  }

  /** 복귀하면 현재 차례 정보를 다시 보낸다 (판은 공유 상태로 전체 전송) */
  resendPrivate(playerId: string): void {
    if (this.phase !== 'PLAYING' || !this.state.currentTurn) return;
    this.io.sendTo(playerId, 'turn_start', {
      playerId: this.state.currentTurn,
      turnId: this.#turnId,
      deadline: this.state.deadline,
      serverNow: this.scheduler.now(),
    });
  }

  protected handleGame(m: Member, type: string, body: Record<string, unknown>): HandleResult {
    if (type === 'place') return this.#place(m, body);
    return fail('INVALID_MESSAGE', '알 수 없는 요청입니다.');
  }

  protected resetMemberForRematch(m: Member): void {
    m.color = null;
    m.view.color = '';
  }

  /** G-13: 같은 방 대기실로 */
  protected resetGameForRematch(): void {
    this.#clearBoard();
  }

  // ───────────────────────── 진행 ─────────────────────────

  /** G-02: 옵션에 따라 흑과 백을 정하고 흑부터 둔다 */
  protected beginGame(): void {
    const seated = this.seated().sort((a, b) => a.joinOrder - b.joinOrder);
    const host = seated.find((x) => x.id === this.state.hostId) ?? seated[0];
    const guest = seated.find((x) => x !== host);
    if (!host || !guest) return;
    let black: Member;
    if (this.opts.blackPolicy === 'host') black = host;
    else if (this.opts.blackPolicy === 'guest') black = guest;
    else black = this.rng.int(2) === 0 ? host : guest;
    const white = black === host ? guest : host;
    black.color = 'black';
    black.view.color = 'black';
    white.color = 'white';
    white.view.color = 'white';

    this.#gameId = this.rng.id();
    this.#startedAt = new Date(this.scheduler.now());
    this.replacedIds.clear();
    this.#clearBoard();
    this.state.phaseEndsAt = 0;
    this.setPhase('PLAYING');
    this.#startTurn('black');
  }

  #clearBoard(): void {
    this.#board = gomoku.emptyBoard();
    for (let i = 0; i < gomoku.GOMOKU_CELLS; i += 1) this.state.board[i] = gomoku.EMPTY;
    this.#moves = [];
    this.state.moveCount = 0;
    this.state.lastMove = -1;
    this.state.result = '';
    this.state.winnerId = '';
    this.state.winLine.clear();
  }

  #startTurn(color: Color): void {
    this.clearTurnTimers();
    this.#turnColor = color;
    const player = this.#byColor(color);
    if (!player) return;
    this.#turnId = this.rng.id();
    const deadline = this.scheduler.now() + this.opts.turnSeconds * this.timing.msPerTurnSecond;
    this.state.currentTurn = player.id;
    this.state.turnId = this.#turnId;
    this.state.deadline = deadline;
    this.io.broadcast('turn_start', {
      playerId: player.id,
      turnId: this.#turnId,
      deadline,
      serverNow: this.scheduler.now(),
    });
    const turnId = this.#turnId;
    // G-21: 사람이 마감까지 두지 않으면 시간패. 끊겨 있어도 같다 (G-23)
    this.setTurnTimer(deadline - this.scheduler.now(), () => {
      if (this.phase !== 'PLAYING' || this.#turnId !== turnId) return;
      const current = this.#byColor(this.#turnColor);
      if (current && current.controller === 'human')
        this.#finish('timeout', gomoku.otherColor(this.#turnColor), []);
    });
    if (player.controller === 'bot') this.#scheduleBot(turnId);
  }

  #scheduleBot(turnId: string): void {
    this.setBotTimer(() => {
      if (this.phase !== 'PLAYING' || this.#turnId !== turnId) return;
      const move = gomoku.gomokuBotMove(this.#board, this.#turnColor, this.opts);
      if (!move) {
        this.#finish('draw', null, []);
        return;
      }
      this.#applyMove(this.#turnColor, move, true);
    });
  }

  /** G-03, G-07, GE-01~GE-05 */
  #place(m: Member, body: Record<string, unknown>): HandleResult {
    if (this.phase !== 'PLAYING') return fail('INVALID_STATE', '대국 중이 아닙니다.');
    if (m.spectator || m.color !== this.#turnColor || m.controller !== 'human')
      return fail('NOT_YOUR_TURN', '내 차례가 아닙니다.');
    if (body.turnId !== this.#turnId) return fail('STALE_TURN', '이미 지난 차례입니다.');
    const x = body.x;
    const y = body.y;
    if (typeof x !== 'number' || typeof y !== 'number') return fail('INVALID_MOVE', '좌표가 올바르지 않습니다.');
    const check = gomoku.checkPlace(this.#board, { x, y }, m.color, this.opts);
    if (!check.ok) {
      const message =
        check.code === 'OCCUPIED'
          ? '이미 돌이 있는 자리입니다.'
          : check.code === 'FORBIDDEN_MOVE'
            ? '흑은 이 자리에 둘 수 없습니다 (금수).'
            : '판 밖입니다.';
      return fail(check.code, message);
    }
    this.#applyMove(m.color, { x, y }, false);
    return OK;
  }

  #applyMove(color: Color, p: gomoku.Point, isBot: boolean): void {
    this.clearTurnTimers();
    const index = gomoku.indexOf(p.x, p.y);
    this.#board = gomoku.placeStone(this.#board, p, color);
    this.state.board[index] = gomoku.stoneOf(color);
    this.#moves.push({ color, x: p.x, y: p.y, isBot });
    this.state.moveCount = this.#moves.length;
    this.state.lastMove = index;
    this.io.broadcast('stone_placed', { color, x: p.x, y: p.y, moveNo: this.#moves.length, isBot });

    const line = gomoku.winningLine(this.#board, p, color, this.opts);
    if (line) {
      this.#finish('five', color, line);
      return;
    }
    if (gomoku.isBoardFull(this.#board)) {
      this.#finish('draw', null, []);
      return;
    }
    this.#startTurn(gomoku.otherColor(color));
  }

  #finish(result: gomoku.GomokuResult, winnerColor: Color | null, line: readonly gomoku.Point[]): void {
    this.clearTurnTimers();
    const winner = winnerColor ? this.#byColor(winnerColor) : undefined;
    this.state.result = result;
    this.state.winnerId = winner?.id ?? '';
    this.state.winLine.clear();
    for (const p of line) this.state.winLine.push(gomoku.indexOf(p.x, p.y));
    this.state.currentTurn = '';
    this.state.turnId = '';
    this.state.deadline = 0;
    this.setPhase('GAME_OVER');
    this.io.broadcast('game_over', {
      result,
      winnerId: winner?.id ?? null,
      line: line.map((p) => ({ x: p.x, y: p.y })),
    });
    this.io.onFinished?.({
      gameId: this.#gameId,
      roomCode: this.state.roomCode,
      startedAt: this.#startedAt,
      endedAt: new Date(this.scheduler.now()),
      options: this.opts,
      players: this.seated()
        .filter((m) => m.color !== null)
        .map((m) => ({
          playerId: m.id,
          guestId: m.guestId,
          nickname: m.nickname,
          color: m.color as Color,
          isBot: m.originallyBot,
          replaced: this.replacedIds.has(m.id),
        })),
      moves: [...this.#moves],
      result,
      winnerColor,
    });
  }

  #byColor(color: Color): Member | undefined {
    return [...this.members.values()].find((m) => !m.spectator && m.color === color);
  }
}
