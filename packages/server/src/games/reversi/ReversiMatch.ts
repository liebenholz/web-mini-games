import { reversi } from '@wmg/rules';
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
import { ReversiPlayerState, ReversiState } from './state.js';

export type { HandleResult, JoinResult } from '../../framework/game/LobbyMatch.js';

type Options = reversi.ReversiRoomOptions;
type Color = reversi.ReversiColor;
type ServerMessages = reversi.ReversiServerMessages;
type ServerMessageType = reversi.ReversiServerMessageType;
type Phase = reversi.ReversiPhase;

export const REVERSI_SPECTATOR_LIMIT = 20;
/** RV-13: 봇은 1~2초 뒤에 둔다 (공통 기본값은 최대 3초) */
const BOT_DELAY_SPAN_MS = 1000;

/** 엔진 → 네트워크. 방 어댑터(ReversiRoom)가 구현한다 */
export interface ReversiIO extends LobbyIO {
  broadcast<T extends ServerMessageType>(type: T, payload: ServerMessages[T]): void;
  sendTo<T extends ServerMessageType>(playerId: string, type: T, payload: ServerMessages[T]): void;
  /** 판이 끝났다 (기록용) */
  onFinished?(record: ReversiRecord): void;
}

export interface ReversiRecord {
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
    readonly isAuto: boolean;
  }[];
  readonly passCount: number;
  readonly black: number;
  readonly white: number;
  readonly result: reversi.ReversiResult;
  readonly winnerColor: Color | null;
}

export interface ReversiDeps {
  readonly io: ReversiIO;
  readonly rng: Rng;
  readonly scheduler: Scheduler;
  readonly timing: Timing;
}

interface Member extends LobbyMember<ReversiPlayerState> {
  color: Color | null;
  /** RV-12: 이어진 시간 초과 수 */
  consecutiveTimeouts: number;
}

type Move = ReversiRecord['moves'][number];

/**
 * 리버시 한 방의 진행 (docs/specs/reversi.md). 대기실·좌석·이탈·리매치는 LobbyMatch(ADR 0003)가 하고,
 * 여기서는 흑백 정하기, 착수·뒤집기, 넘김, 시간 초과 대신 두기, 봇, 판 기록만 다룬다.
 */
export class ReversiMatch extends LobbyMatch<Options, ReversiPlayerState, Member, ReversiState, ReversiIO> {
  #board: reversi.Cell[] = reversi.initialBoard();
  #moves: Move[] = [];
  #passCount = 0;
  #gameId = '';
  #startedAt = new Date(0);
  #turnColor: Color = 'black';
  #turnId = '';

  constructor(roomCode: string, options: Options, deps: ReversiDeps) {
    super(new ReversiState(), roomCode, options, deps);
    this.writeOptions();
    for (let i = 0; i < reversi.REVERSI_CELLS; i += 1) this.state.board.push(reversi.EMPTY);
    this.#clearBoard();
    this.updateListing();
  }

  override get phase(): Phase {
    return this.state.phase as Phase;
  }

  // ───────────────────────── 대기실 훅 ─────────────────────────

  protected maxSeats(): number {
    return reversi.REVERSI_PLAYERS;
  }

  protected spectatorLimit(): number {
    return REVERSI_SPECTATOR_LIMIT;
  }

  protected createView(init: NewView): ReversiPlayerState {
    return new ReversiPlayerState({ ...init });
  }

  protected createMember(base: LobbyMember<ReversiPlayerState>): Member {
    return { ...base, color: null, consecutiveTimeouts: 0 };
  }

  protected parseOptions(input: unknown): { ok: true; options: Options } | { ok: false } {
    return reversi.parseReversiOptions(input, this.opts);
  }

  protected writeOptions(): void {
    const o = this.state.options;
    const v = this.opts;
    o.blackPolicy = v.blackPolicy;
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

  protected override botDelay(): number {
    const { botDelayMinMs: min, botDelayMaxMs: max } = this.timing;
    const span = Math.max(0, Math.min(max - min, BOT_DELAY_SPAN_MS));
    return min + (span > 0 ? this.rng.int(span + 1) : 0);
  }

  protected notifyReplaced(m: Member, reason: ReplaceReason): void {
    this.io.broadcast('player_replaced', { playerId: m.id, nickname: m.nickname, reason });
  }

  /** RV-11: 게임 중 나가면 봇이 이어서 두고, 상대에게 알린다 */
  protected onSeatTakenOver(m: Member): void {
    m.view.replaced = true;
    m.view.autopilot = false;
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
    m.consecutiveTimeouts = 0;
    m.view.color = '';
    m.view.autopilot = false;
  }

  /** RV-08: 같은 방 대기실로 */
  protected resetGameForRematch(): void {
    this.#clearBoard();
  }

  // ───────────────────────── 진행 ─────────────────────────

  /** RV-02: 옵션에 따라 흑과 백을 정하고 흑부터 둔다 */
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
    for (const [m, color] of [
      [black, 'black'],
      [white, 'white'],
    ] as const) {
      m.color = color;
      m.consecutiveTimeouts = 0;
      m.view.color = color;
      m.view.autopilot = false;
    }

    this.#gameId = this.rng.id();
    this.#startedAt = new Date(this.scheduler.now());
    this.replacedIds.clear();
    this.#clearBoard();
    this.state.phaseEndsAt = 0;
    this.setPhase('PLAYING');
    this.#startTurn('black');
  }

  /** RV-01: 처음 배치로 */
  #clearBoard(): void {
    this.#board = reversi.initialBoard();
    for (let i = 0; i < reversi.REVERSI_CELLS; i += 1) this.state.board[i] = this.#board[i] ?? reversi.EMPTY;
    this.#moves = [];
    this.#passCount = 0;
    this.state.moveCount = 0;
    this.state.passCount = 0;
    this.state.lastMove = -1;
    this.state.result = '';
    this.state.winnerId = '';
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
    // RV-12: 마감까지 두지 않으면 서버가 대신 둔다. 끊겨 있어도 같다 (RV-11). 봇 자리는 시간 초과가 없다 (RV-14)
    this.setTurnTimer(deadline - this.scheduler.now(), () => this.#onTimeout(turnId));
    if (player.controller !== 'human') this.#scheduleBot(turnId);
  }

  /** RV-12: 대신 두고, 2번 연속이면 봇이 이어서 둔다 */
  #onTimeout(turnId: string): void {
    if (this.phase !== 'PLAYING' || this.#turnId !== turnId) return;
    const m = this.#byColor(this.#turnColor);
    if (!m || m.controller !== 'human') return;
    m.consecutiveTimeouts += 1;
    if (m.consecutiveTimeouts >= 2) {
      m.controller = 'autopilot';
      m.view.autopilot = true;
    }
    this.#autoMove(true);
  }

  #scheduleBot(turnId: string): void {
    this.setBotTimer(() => {
      if (this.phase !== 'PLAYING' || this.#turnId !== turnId) return;
      const m = this.#byColor(this.#turnColor);
      if (!m || m.controller === 'human') return;
      this.#autoMove(m.controller === 'autopilot');
    });
  }

  /** 봇과 같은 판단으로 둔다 (RV-13). 차례가 오면 둘 곳은 항상 있다 (넘김은 착수 뒤에 처리) */
  #autoMove(isAuto: boolean): void {
    const color = this.#turnColor;
    const p = reversi.reversiBotMove(this.#board, color, this.rng.int(1_000_000) / 1_000_000);
    if (!p) return;
    const placed = reversi.placeStone(this.#board, p, color);
    if (!placed.ok) return;
    const m = this.#byColor(color);
    this.#applyMove(color, p, placed, { isBot: m?.controller === 'bot', isAuto });
  }

  /** RV-03, RV-04, 7장 예외 */
  #place(m: Member, body: Record<string, unknown>): HandleResult {
    if (this.phase !== 'PLAYING') return fail('INVALID_STATE', '대국 중이 아닙니다.');
    if (m.spectator || m.color !== this.#turnColor || m.controller === 'bot')
      return fail('NOT_YOUR_TURN', '내 차례가 아닙니다.');
    if (body.turnId !== this.#turnId) return fail('STALE_TURN', '이미 지난 차례입니다.');
    const x = body.x;
    const y = body.y;
    if (typeof x !== 'number' || typeof y !== 'number')
      return fail('INVALID_MOVE', '좌표가 올바르지 않습니다.');
    const placed = reversi.placeStone(this.#board, { x, y }, m.color);
    if (!placed.ok) return fail('INVALID_MOVE', '뒤집을 돌이 있는 빈칸에만 둘 수 있습니다.');
    // RV-12: 직접 두면 돌려받는다
    m.consecutiveTimeouts = 0;
    if (m.controller === 'autopilot') {
      m.controller = 'human';
      m.view.autopilot = false;
    }
    this.#applyMove(m.color, { x, y }, placed, { isBot: false, isAuto: false });
    return OK;
  }

  #applyMove(
    color: Color,
    p: reversi.Point,
    placed: { readonly board: reversi.Cell[]; readonly flips: readonly reversi.Point[] },
    how: { readonly isBot: boolean; readonly isAuto: boolean },
  ): void {
    this.clearTurnTimers();
    this.#board = placed.board;
    const index = reversi.indexOf(p);
    const stone = reversi.stoneOf(color);
    this.state.board[index] = stone;
    for (const f of placed.flips) this.state.board[reversi.indexOf(f)] = stone;
    this.#moves.push({ color, x: p.x, y: p.y, ...how });
    this.state.moveCount = this.#moves.length;
    this.state.lastMove = index;
    this.io.broadcast('stone_placed', {
      color,
      x: p.x,
      y: p.y,
      flipped: placed.flips.map((f) => ({ x: f.x, y: f.y })),
      moveNo: this.#moves.length,
      ...how,
    });

    const { next, passed } = reversi.nextTurn(this.#board, color);
    if (next === null) {
      this.#finish();
      return;
    }
    if (passed) {
      // RV-05: 사람이 고르지 않고 서버가 넘긴다
      this.#passCount += 1;
      this.state.passCount = this.#passCount;
      const who = this.#byColor(passed);
      if (who) this.io.broadcast('turn_passed', { playerId: who.id });
    }
    this.#startTurn(next);
  }

  /** RV-06, RV-07 */
  #finish(): void {
    this.clearTurnTimers();
    const { black, white } = reversi.countStones(this.#board);
    const winnerColor = reversi.winnerOf(this.#board);
    const result: reversi.ReversiResult = winnerColor ? 'count' : 'draw';
    const winner = winnerColor ? this.#byColor(winnerColor) : undefined;
    this.state.result = result;
    this.state.winnerId = winner?.id ?? '';
    this.state.currentTurn = '';
    this.state.turnId = '';
    this.state.deadline = 0;
    this.setPhase('GAME_OVER');
    this.io.broadcast('game_over', { result, winnerId: winner?.id ?? null, black, white });
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
      passCount: this.#passCount,
      black,
      white,
      result,
      winnerColor,
    });
  }

  #byColor(color: Color): Member | undefined {
    return [...this.members.values()].find((m) => !m.spectator && m.color === color);
  }
}
