import { gomoku, normalizeNickname, type ErrorCode } from '@wmg/rules';
import type { Rng } from '../../framework/rng.js';
import type { Scheduler } from '../../framework/scheduler.js';
import type { Timing } from '../liars-dice/LiarsDiceMatch.js';
import { GomokuPlayerState, GomokuState } from './state.js';

type Options = gomoku.GomokuRoomOptions;
type Color = gomoku.GomokuColor;
type ServerMessages = gomoku.GomokuServerMessages;
type ServerMessageType = gomoku.GomokuServerMessageType;
type Phase = gomoku.GomokuPhase;

export const GOMOKU_SPECTATOR_LIMIT = 20;

/** 엔진 → 네트워크. 방 어댑터(GomokuRoom)가 구현한다 */
export interface GomokuIO {
  broadcast<T extends ServerMessageType>(type: T, payload: ServerMessages[T]): void;
  sendTo<T extends ServerMessageType>(playerId: string, type: T, payload: ServerMessages[T]): void;
  /** 사람이 모두 나갔다. 방을 닫는다 (기록하지 않음) */
  onAbandoned(): void;
  onListingChange(listed: boolean): void;
  /** 방장이 이 참가자를 내보냈다. 연결을 KICKED로 닫는다 */
  onKick(playerId: string): void;
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

export type JoinResult =
  | {
      readonly ok: true;
      readonly playerId: string;
      readonly role: 'player' | 'spectator';
      readonly reclaimed: boolean;
    }
  | { readonly ok: false; readonly code: ErrorCode };

export type HandleResult =
  { readonly ok: true } | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

const OK: HandleResult = { ok: true };
const fail = (code: ErrorCode, message: string): HandleResult => ({ ok: false, code, message });

interface Member {
  readonly id: string;
  readonly guestId: string | null;
  readonly nickname: string;
  readonly joinOrder: number;
  readonly originallyBot: boolean;
  /** 지금 이 자리를 누가 두는가 */
  controller: 'human' | 'bot';
  /** 사람이 방 안에 있거나 재접속 대기 중 */
  present: boolean;
  spectator: boolean;
  ready: boolean;
  color: Color | null;
  readonly view: GomokuPlayerState;
}

/**
 * 오목 한 방의 진행 (docs/specs/gomoku.md). 네트워크와 분리된 엔진이라 VirtualScheduler로 테스트한다.
 * 대기실(입장, 준비, 옵션, 봇, 추방, 방장 위임)은 거짓말쟁이 주사위와 같은 규칙을 따른다.
 */
export class GomokuMatch {
  readonly state = new GomokuState();
  readonly #io: GomokuIO;
  readonly #rng: Rng;
  readonly #scheduler: Scheduler;
  readonly #timing: Timing;
  #options: Options;
  #members = new Map<string, Member>();
  #byGuest = new Map<string, string>();
  readonly #kicked = new Set<string>();
  #board: gomoku.Cell[] = gomoku.emptyBoard();
  #moves: { color: Color; x: number; y: number; isBot: boolean }[] = [];
  #gameId = '';
  #startedAt = new Date(0);
  /** ST-08: 이번 판에서 봇이 자리를 이어받은 사람 (돌아와도 남긴다) */
  readonly #replacedIds = new Set<string>();
  #turnColor: Color = 'black';
  #turnId = '';
  #cancelTurn: (() => void) | null = null;
  #cancelBot: (() => void) | null = null;
  #cancelPhase: (() => void) | null = null;
  #joinCounter = 0;
  #botCounter = 0;
  #listed = false;
  #disposed = false;

  constructor(roomCode: string, options: Options, deps: GomokuDeps) {
    this.#io = deps.io;
    this.#rng = deps.rng;
    this.#scheduler = deps.scheduler;
    this.#timing = deps.timing;
    this.#options = options;
    this.state.roomCode = roomCode;
    this.#writeOptions();
    for (let i = 0; i < gomoku.GOMOKU_CELLS; i += 1) this.state.board.push(gomoku.EMPTY);
    this.#updateListing();
  }

  get phase(): Phase {
    return this.state.phase as Phase;
  }

  get options(): Options {
    return this.#options;
  }

  // ───────────────────────── 입장 / 퇴장 ─────────────────────────

  join(guestId: string, rawNickname: unknown): JoinResult {
    if (this.#kicked.has(guestId)) return { ok: false, code: 'KICKED' };
    const existingId = this.#byGuest.get(guestId);
    const existing = existingId ? this.#members.get(existingId) : undefined;
    if (existing && existing.present) {
      existing.view.connected = true;
      return {
        ok: true,
        playerId: existing.id,
        role: existing.spectator ? 'spectator' : 'player',
        reclaimed: true,
      };
    }
    const nickname = normalizeNickname(rawNickname);
    if (nickname === null) return { ok: false, code: 'INVALID_NICKNAME' };

    let spectator = false;
    if (this.phase === 'WAITING') {
      if (this.#seated().length >= gomoku.GOMOKU_PLAYERS) return { ok: false, code: 'ROOM_FULL' };
    } else {
      // GE-07: 게임 중 입장은 관전자
      if (this.#spectators().length >= GOMOKU_SPECTATOR_LIMIT) return { ok: false, code: 'ROOM_FULL' };
      spectator = true;
    }
    const member = this.#addMember({ guestId, nickname, bot: false, spectator });
    if (!this.state.hostId) this.#setHost(member);
    this.#updateListing();
    return { ok: true, playerId: member.id, role: spectator ? 'spectator' : 'player', reclaimed: false };
  }

  /** G-23: 연결 끊김. 자리는 유지하고 상대에게 알린다. 시간은 그대로 흐른다 (시간패) */
  disconnect(playerId: string): void {
    const m = this.#members.get(playerId);
    if (!m) return;
    m.view.connected = false;
    if (this.phase === 'PLAYING' && !m.spectator) this.#notifyReplaced(m, 'disconnected');
  }

  reconnect(playerId: string): void {
    const m = this.#members.get(playerId);
    if (!m || !m.present) return;
    const wasOff = !m.view.connected;
    m.view.connected = true;
    if (wasOff && this.phase === 'PLAYING' && !m.spectator) this.#notifyReplaced(m, 'returned');
    this.resendPrivate(playerId);
  }

  /** 복귀하면 현재 차례 정보를 다시 보낸다 (판은 공유 상태로 전체 전송) */
  resendPrivate(playerId: string): void {
    if (this.phase !== 'PLAYING' || !this.state.currentTurn) return;
    this.#io.sendTo(playerId, 'turn_start', {
      playerId: this.state.currentTurn,
      turnId: this.#turnId,
      deadline: this.state.deadline,
      serverNow: this.#scheduler.now(),
    });
  }

  /** 사람이 방을 떠났다 (스스로 나감 또는 재접속 시간 초과). G-22: 게임 중이면 봇이 이어서 둔다 */
  leave(playerId: string): void {
    const m = this.#members.get(playerId);
    if (!m || m.controller === 'bot') return;
    if (m.guestId) this.#byGuest.delete(m.guestId);

    if (m.spectator || this.phase === 'WAITING') {
      this.#removeMember(m);
    } else if (this.phase === 'GAME_OVER') {
      m.present = false;
      m.view.connected = false;
    } else {
      m.present = false;
      if (!m.originallyBot) this.#replacedIds.add(m.id);
      m.controller = 'bot';
      m.view.isBot = true;
      m.view.replaced = true;
      m.view.connected = true;
      this.#notifyReplaced(m, 'left');
      if (this.phase === 'PLAYING' && m.color === this.#turnColor) this.#scheduleBot(this.#turnId);
    }

    if (this.state.hostId === m.id) {
      m.view.isHost = false;
      this.state.hostId = '';
      const next = this.#earliestHuman();
      if (next) this.#setHost(next);
    }
    this.#updateListing();
    this.#checkAbandoned();
  }

  // ───────────────────────── 메시지 처리 ─────────────────────────

  handle(playerId: string, type: string, payload: unknown): HandleResult {
    const m = this.#members.get(playerId);
    if (!m || this.#disposed) return fail('INVALID_STATE', '방에 참가하고 있지 않습니다.');
    const body = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
    switch (type) {
      case 'set_ready':
        return this.#setReady(m, body);
      case 'set_options':
        return this.#setOptions(m, body);
      case 'add_bot':
        return this.#addBot(m);
      case 'remove_bot':
        return this.#removeBot(m, body);
      case 'kick_player':
        return this.#kickPlayer(m, body);
      case 'start_game':
        return this.#startGame(m);
      case 'place':
        return this.#place(m, body);
      case 'rematch':
        return this.#rematch(m);
      default:
        return fail('INVALID_MESSAGE', '알 수 없는 요청입니다.');
    }
  }

  #setReady(m: Member, body: Record<string, unknown>): HandleResult {
    if (this.phase !== 'WAITING') return fail('INVALID_STATE', '대기실에서만 준비할 수 있습니다.');
    if (typeof body.ready !== 'boolean') return fail('INVALID_MESSAGE', '잘못된 요청입니다.');
    if (m.spectator) return fail('INVALID_STATE', '관전자는 준비할 수 없습니다.');
    m.ready = body.ready;
    m.view.ready = body.ready;
    return OK;
  }

  #setOptions(m: Member, body: Record<string, unknown>): HandleResult {
    if (this.phase !== 'WAITING') return fail('INVALID_STATE', '대기실에서만 옵션을 바꿀 수 있습니다.');
    if (this.state.hostId !== m.id) return fail('NOT_HOST', '방장만 옵션을 바꿀 수 있습니다.');
    const parsed = gomoku.parseGomokuOptions(body.options, this.#options);
    if (!parsed.ok) return fail('INVALID_OPTIONS', '옵션 값이 올바르지 않습니다.');
    this.#options = parsed.options;
    this.#writeOptions();
    this.#updateListing();
    return OK;
  }

  #addBot(m: Member): HandleResult {
    if (this.phase !== 'WAITING') return fail('INVALID_STATE', '대기실에서만 봇을 추가할 수 있습니다.');
    if (this.state.hostId !== m.id) return fail('NOT_HOST', '방장만 봇을 추가할 수 있습니다.');
    if (this.#seated().length >= gomoku.GOMOKU_PLAYERS) return fail('ROOM_FULL', '자리가 없습니다.');
    this.#addBotMember();
    this.#updateListing();
    return OK;
  }

  #removeBot(m: Member, body: Record<string, unknown>): HandleResult {
    if (this.phase !== 'WAITING') return fail('INVALID_STATE', '대기실에서만 봇을 뺄 수 있습니다.');
    if (this.state.hostId !== m.id) return fail('NOT_HOST', '방장만 봇을 뺄 수 있습니다.');
    const target = typeof body.playerId === 'string' ? this.#members.get(body.playerId) : undefined;
    if (!target || !target.originallyBot) return fail('INVALID_MESSAGE', '봇을 찾을 수 없습니다.');
    this.#removeMember(target);
    this.#updateListing();
    return OK;
  }

  /** E-15와 같다: 방장만, 대기실에서, 사람만. 같은 게스트 ID는 이 방에 다시 못 들어온다 */
  #kickPlayer(m: Member, body: Record<string, unknown>): HandleResult {
    if (this.phase !== 'WAITING') return fail('INVALID_STATE', '대기실에서만 내보낼 수 있습니다.');
    if (this.state.hostId !== m.id) return fail('NOT_HOST', '방장만 내보낼 수 있습니다.');
    const target = typeof body.playerId === 'string' ? this.#members.get(body.playerId) : undefined;
    if (!target || target.originallyBot || target.id === m.id)
      return fail('INVALID_MESSAGE', '내보낼 참가자를 찾을 수 없습니다.');
    if (target.guestId) this.#kicked.add(target.guestId);
    this.#io.onKick(target.id);
    this.leave(target.id);
    return OK;
  }

  #startGame(m: Member): HandleResult {
    if (this.phase !== 'WAITING') return fail('INVALID_STATE', '이미 시작했습니다.');
    if (this.state.hostId !== m.id) return fail('NOT_HOST', '방장만 시작할 수 있습니다.');
    const seated = this.#seated();
    if (seated.some((x) => x.controller === 'human' && !x.ready && x.id !== m.id))
      return fail('NOT_ALL_READY', '모두 준비해야 시작할 수 있습니다.');
    if (seated.length < gomoku.GOMOKU_PLAYERS) {
      if (!this.#options.fillWithBots) return fail('NOT_ENOUGH_PLAYERS', '2명이 필요합니다.');
      while (this.#seated().length < gomoku.GOMOKU_PLAYERS) this.#addBotMember();
    }
    this.#setPhase('STARTING');
    this.#updateListing();
    const endsAt = this.#scheduler.now() + this.#timing.startCountdownMs;
    this.state.phaseEndsAt = endsAt;
    this.#cancelPhase = this.#scheduler.after(this.#timing.startCountdownMs, () => {
      this.#cancelPhase = null;
      this.#beginGame();
    });
    return OK;
  }

  /** G-02: 옵션에 따라 흑과 백을 정하고 흑부터 둔다 */
  #beginGame(): void {
    const seated = this.#seated().sort((a, b) => a.joinOrder - b.joinOrder);
    const host = seated.find((x) => x.id === this.state.hostId) ?? seated[0];
    const guest = seated.find((x) => x !== host);
    if (!host || !guest) return;
    let black: Member;
    if (this.#options.blackPolicy === 'host') black = host;
    else if (this.#options.blackPolicy === 'guest') black = guest;
    else black = this.#rng.int(2) === 0 ? host : guest;
    const white = black === host ? guest : host;
    black.color = 'black';
    black.view.color = 'black';
    white.color = 'white';
    white.view.color = 'white';

    this.#gameId = this.#rng.id();
    this.#startedAt = new Date(this.#scheduler.now());
    this.#replacedIds.clear();
    this.#board = gomoku.emptyBoard();
    for (let i = 0; i < gomoku.GOMOKU_CELLS; i += 1) this.state.board[i] = gomoku.EMPTY;
    this.#moves = [];
    this.state.moveCount = 0;
    this.state.lastMove = -1;
    this.state.result = '';
    this.state.winnerId = '';
    this.state.winLine.clear();
    this.state.phaseEndsAt = 0;
    this.#setPhase('PLAYING');
    this.#startTurn('black');
  }

  #startTurn(color: Color): void {
    this.#clearTurnTimers();
    this.#turnColor = color;
    const player = this.#byColor(color);
    if (!player) return;
    this.#turnId = this.#rng.id();
    const deadline = this.#scheduler.now() + this.#options.turnSeconds * this.#timing.msPerTurnSecond;
    this.state.currentTurn = player.id;
    this.state.turnId = this.#turnId;
    this.state.deadline = deadline;
    this.#io.broadcast('turn_start', {
      playerId: player.id,
      turnId: this.#turnId,
      deadline,
      serverNow: this.#scheduler.now(),
    });
    const turnId = this.#turnId;
    // G-21: 사람이 마감까지 두지 않으면 시간패. 끊겨 있어도 같다 (G-23)
    this.#cancelTurn = this.#scheduler.after(deadline - this.#scheduler.now(), () => {
      this.#cancelTurn = null;
      if (this.phase !== 'PLAYING' || this.#turnId !== turnId) return;
      const current = this.#byColor(this.#turnColor);
      if (current && current.controller === 'human')
        this.#finish('timeout', gomoku.otherColor(this.#turnColor), []);
    });
    if (player.controller === 'bot') this.#scheduleBot(turnId);
  }

  #scheduleBot(turnId: string): void {
    this.#cancelBot?.();
    const span = Math.max(0, this.#timing.botDelayMaxMs - this.#timing.botDelayMinMs);
    const delay = this.#timing.botDelayMinMs + (span > 0 ? this.#rng.int(span + 1) : 0);
    this.#cancelBot = this.#scheduler.after(delay, () => {
      this.#cancelBot = null;
      if (this.phase !== 'PLAYING' || this.#turnId !== turnId) return;
      const move = gomoku.gomokuBotMove(this.#board, this.#turnColor, this.#options);
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
    if (typeof x !== 'number' || typeof y !== 'number')
      return fail('INVALID_MOVE', '좌표가 올바르지 않습니다.');
    const check = gomoku.checkPlace(this.#board, { x, y }, m.color, this.#options);
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
    this.#clearTurnTimers();
    const index = gomoku.indexOf(p.x, p.y);
    this.#board = gomoku.placeStone(this.#board, p, color);
    this.state.board[index] = gomoku.stoneOf(color);
    this.#moves.push({ color, x: p.x, y: p.y, isBot });
    this.state.moveCount = this.#moves.length;
    this.state.lastMove = index;
    this.#io.broadcast('stone_placed', { color, x: p.x, y: p.y, moveNo: this.#moves.length, isBot });

    const line = gomoku.winningLine(this.#board, p, color, this.#options);
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
    this.#clearTurnTimers();
    const winner = winnerColor ? this.#byColor(winnerColor) : undefined;
    this.state.result = result;
    this.state.winnerId = winner?.id ?? '';
    this.state.winLine.clear();
    for (const p of line) this.state.winLine.push(gomoku.indexOf(p.x, p.y));
    this.state.currentTurn = '';
    this.state.turnId = '';
    this.state.deadline = 0;
    this.#setPhase('GAME_OVER');
    this.#io.broadcast('game_over', {
      result,
      winnerId: winner?.id ?? null,
      line: line.map((p) => ({ x: p.x, y: p.y })),
    });
    this.#io.onFinished?.({
      gameId: this.#gameId,
      roomCode: this.state.roomCode,
      startedAt: this.#startedAt,
      endedAt: new Date(this.#scheduler.now()),
      options: this.#options,
      players: this.#seated()
        .filter((m) => m.color !== null)
        .map((m) => ({
          playerId: m.id,
          guestId: m.guestId,
          nickname: m.nickname,
          color: m.color as Color,
          isBot: m.originallyBot,
          replaced: this.#replacedIds.has(m.id),
        })),
      moves: [...this.#moves],
      result,
      winnerColor,
    });
  }

  /** G-13: 같은 방 대기실로. 나간 사람(봇이 이어받은 자리)은 정리한다 */
  #rematch(m: Member): HandleResult {
    if (this.phase !== 'GAME_OVER') return fail('INVALID_STATE', '게임이 끝난 뒤에만 다시 할 수 있습니다.');
    if (!m.present) return fail('INVALID_STATE', '방에 없습니다.');
    for (const x of [...this.#members.values()]) {
      if (!x.originallyBot && !x.present) {
        this.#removeMember(x);
        continue;
      }
      x.color = null;
      x.view.color = '';
      x.spectator = false;
      x.view.spectator = false;
      if (x.controller === 'human') {
        x.ready = x.id === this.state.hostId;
        x.view.ready = x.ready;
      }
    }
    // 관전자가 많으면 두 자리만 남기고 다시 관전자로
    const seated = this.#seated().sort(
      (a, b) => Number(a.originallyBot) - Number(b.originallyBot) || a.joinOrder - b.joinOrder,
    );
    seated.slice(gomoku.GOMOKU_PLAYERS).forEach((x) => {
      if (x.originallyBot) this.#removeMember(x);
      else {
        x.spectator = true;
        x.view.spectator = true;
      }
    });
    this.#board = gomoku.emptyBoard();
    for (let i = 0; i < gomoku.GOMOKU_CELLS; i += 1) this.state.board[i] = gomoku.EMPTY;
    this.#moves = [];
    this.state.moveCount = 0;
    this.state.lastMove = -1;
    this.state.result = '';
    this.state.winnerId = '';
    this.state.winLine.clear();
    this.#setPhase('WAITING');
    this.#updateListing();
    return OK;
  }

  // ───────────────────────── 보조 ─────────────────────────

  #notifyReplaced(m: Member, reason: gomoku.ReplaceReason): void {
    this.#io.broadcast('player_replaced', { playerId: m.id, nickname: m.nickname, reason });
  }

  #checkAbandoned(): void {
    const humans = [...this.#members.values()].filter((m) => m.present && m.controller !== 'bot');
    const seatedHumans = humans.filter((m) => !m.spectator);
    // GE-06: 사람이 모두 나가면 방 종료, 기록하지 않음
    if (
      humans.length === 0 ||
      (this.phase !== 'WAITING' && this.phase !== 'GAME_OVER' && seatedHumans.length === 0)
    ) {
      this.dispose();
      this.#io.onAbandoned();
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#clearTurnTimers();
    this.#cancelPhase?.();
    this.#cancelPhase = null;
  }

  #byColor(color: Color): Member | undefined {
    return [...this.#members.values()].find((m) => !m.spectator && m.color === color);
  }

  #seated(): Member[] {
    return [...this.#members.values()].filter((m) => !m.spectator);
  }

  #spectators(): Member[] {
    return [...this.#members.values()].filter((m) => m.spectator);
  }

  #earliestHuman(): Member | undefined {
    return [...this.#members.values()]
      .filter((m) => m.present && m.controller !== 'bot')
      .sort((a, b) => Number(a.spectator) - Number(b.spectator) || a.joinOrder - b.joinOrder)[0];
  }

  #setHost(m: Member): void {
    this.state.hostId = m.id;
    m.view.isHost = true;
    m.ready = true;
    m.view.ready = true;
  }

  #publicId(prefix: string): string {
    for (;;) {
      const id = `${prefix}${this.#rng.id().replace(/-/g, '').slice(0, 12)}`;
      if (!this.#members.has(id)) return id;
    }
  }

  #addMember(input: { guestId: string | null; nickname: string; bot: boolean; spectator: boolean }): Member {
    const id = this.#publicId(input.bot ? 'b_' : 'p_');
    const view = new GomokuPlayerState({
      id,
      nickname: input.nickname,
      isBot: input.bot,
      ready: input.bot,
      spectator: input.spectator,
      connected: true,
    });
    const member: Member = {
      id,
      guestId: input.guestId,
      nickname: input.nickname,
      joinOrder: (this.#joinCounter += 1),
      originallyBot: input.bot,
      controller: input.bot ? 'bot' : 'human',
      present: !input.bot,
      spectator: input.spectator,
      ready: input.bot,
      color: null,
      view,
    };
    this.#members.set(id, member);
    if (input.guestId) this.#byGuest.set(input.guestId, id);
    this.state.players.set(id, view);
    return member;
  }

  #addBotMember(): Member {
    const used = new Set([...this.#members.values()].map((m) => m.nickname));
    let name: string;
    do {
      this.#botCounter += 1;
      name = `봇 ${this.#botCounter}`;
    } while (used.has(name));
    return this.#addMember({ guestId: null, nickname: name, bot: true, spectator: false });
  }

  #removeMember(m: Member): void {
    this.#members.delete(m.id);
    if (m.guestId && this.#byGuest.get(m.guestId) === m.id) this.#byGuest.delete(m.guestId);
    this.state.players.delete(m.id);
  }

  #writeOptions(): void {
    const o = this.state.options;
    const v = this.#options;
    o.blackPolicy = v.blackPolicy;
    o.forbidDoubleThree = v.forbidDoubleThree;
    o.forbidDoubleFour = v.forbidDoubleFour;
    o.forbidOverline = v.forbidOverline;
    o.turnSeconds = v.turnSeconds;
    o.fillWithBots = v.fillWithBots;
    o.isPrivate = v.isPrivate;
  }

  #updateListing(): void {
    const listed =
      !this.#options.isPrivate && this.phase === 'WAITING' && this.#seated().length < gomoku.GOMOKU_PLAYERS;
    if (listed !== this.#listed) {
      this.#listed = listed;
      this.#io.onListingChange(listed);
    }
  }

  #setPhase(phase: Phase): void {
    this.state.phase = phase;
  }

  #clearTurnTimers(): void {
    this.#cancelTurn?.();
    this.#cancelBot?.();
    this.#cancelTurn = null;
    this.#cancelBot = null;
  }
}
