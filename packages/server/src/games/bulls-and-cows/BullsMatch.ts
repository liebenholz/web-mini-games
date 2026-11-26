import { bulls, normalizeNickname, type ErrorCode } from '@wmg/rules';
import type { Rng } from '../../framework/rng.js';
import type { Scheduler } from '../../framework/scheduler.js';
import type { Timing } from '../liars-dice/LiarsDiceMatch.js';
import { BullsGuessState, BullsPlayerState, BullsState } from './state.js';

type Options = bulls.BullsRoomOptions;
type Phase = bulls.BullsPhase;
type Seat = 0 | 1;
type ServerMessages = bulls.BullsServerMessages;
type ServerMessageType = bulls.BullsServerMessageType;

export const BULLS_SPECTATOR_LIMIT = 20;

/** 엔진 → 네트워크. 방 어댑터(BullsRoom)가 구현한다 */
export interface BullsIO {
  broadcast<T extends ServerMessageType>(type: T, payload: ServerMessages[T]): void;
  sendTo<T extends ServerMessageType>(playerId: string, type: T, payload: ServerMessages[T]): void;
  /** 사람이 모두 나갔다. 방을 닫는다 (기록하지 않음, BE-05) */
  onAbandoned(): void;
  onListingChange(listed: boolean): void;
  onKick(playerId: string): void;
  onFinished?(record: BullsRecord): void;
}

export interface BullsRecord {
  readonly gameId: string;
  readonly roomCode: string;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly options: Options;
  readonly players: readonly {
    readonly guestId: string | null;
    readonly nickname: string;
    readonly seat: Seat;
    readonly attempts: number;
    readonly isBot: boolean;
    readonly replaced: boolean;
  }[];
  readonly result: bulls.BullsEndResult;
  readonly winnerSeat: Seat | null;
  readonly lastChance: boolean;
  readonly skippedTurns: number;
}

export interface BullsDeps {
  readonly io: BullsIO;
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

const MESSAGES: Record<bulls.BullsErrorCode, string> = {
  NOT_YOUR_TURN: '내 차례가 아닙니다.',
  INVALID_GUESS: '0~9 숫자를 겹치지 않게 자릿수만큼 넣어 주세요.',
  INVALID_STATE: '지금은 할 수 없습니다.',
};

interface Member {
  readonly id: string;
  readonly guestId: string | null;
  readonly nickname: string;
  readonly joinOrder: number;
  readonly originallyBot: boolean;
  /** autopilot = 시간 초과 2번으로 봇이 대신 (B-32), bot = 봇 또는 나간 사람 자리 (B-34) */
  controller: 'human' | 'autopilot' | 'bot';
  present: boolean;
  spectator: boolean;
  ready: boolean;
  seat: Seat | null;
  secret: string;
  consecutiveTimeouts: number;
  readonly view: BullsPlayerState;
}

/**
 * 숫자야구 한 방의 진행 (docs/specs/bulls-and-cows.md). 규칙은 @wmg/rules의 bulls 엔진이 판정하고,
 * 여기서는 비밀 숫자 단계(B-30), 턴 시간(B-31, B-32), 봇, 정보 은닉(B-20~B-23), 대기실을 맡는다.
 */
export class BullsMatch {
  readonly state = new BullsState();
  readonly #io: BullsIO;
  readonly #rng: Rng;
  readonly #scheduler: Scheduler;
  readonly #timing: Timing;
  #options: Options;
  #members = new Map<string, Member>();
  #byGuest = new Map<string, string>();
  readonly #kicked = new Set<string>();
  #game: bulls.BullsState | null = null;
  #gameId = '';
  #startedAt = new Date(0);
  /** ST-08: 이번 판에서 봇이 자리를 이어받은 사람 (돌아와도 남긴다) */
  readonly #replacedIds = new Set<string>();
  #skipped = 0;
  #hadLastChance = false;
  #turnId = '';
  #cancelTurn: (() => void) | null = null;
  #cancelBot: (() => void) | null = null;
  #cancelPhase: (() => void) | null = null;
  #joinCounter = 0;
  #botCounter = 0;
  #listed = false;
  #disposed = false;

  constructor(roomCode: string, options: Options, deps: BullsDeps) {
    this.#io = deps.io;
    this.#rng = deps.rng;
    this.#scheduler = deps.scheduler;
    this.#timing = deps.timing;
    this.#options = options;
    this.state.roomCode = roomCode;
    this.#writeOptions();
    this.#updateListing();
  }

  get phase(): Phase {
    return this.state.phase as Phase;
  }

  /** 테스트용: 서버만 아는 진행 상태 */
  get game(): bulls.BullsState | null {
    return this.#game;
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
      if (this.#seated().length >= bulls.BULLS_PLAYERS) return { ok: false, code: 'ROOM_FULL' };
    } else {
      // BE-06: 게임 중 입장은 관전자
      if (this.#spectators().length >= BULLS_SPECTATOR_LIMIT) return { ok: false, code: 'ROOM_FULL' };
      spectator = true;
    }
    const member = this.#addMember({ guestId, nickname, bot: false, spectator });
    if (!this.state.hostId) this.#setHost(member);
    this.#updateListing();
    return { ok: true, playerId: member.id, role: spectator ? 'spectator' : 'player', reclaimed: false };
  }

  /** B-33: 연결 끊김. 자리는 유지하고 상대에게 알린다 */
  disconnect(playerId: string): void {
    const m = this.#members.get(playerId);
    if (!m) return;
    m.view.connected = false;
    if (this.#inGame() && !m.spectator) this.#notifyReplaced(m, 'disconnected');
  }

  reconnect(playerId: string): void {
    const m = this.#members.get(playerId);
    if (!m || !m.present) return;
    const wasOff = !m.view.connected;
    m.view.connected = true;
    if (wasOff && this.#inGame() && !m.spectator) this.#notifyReplaced(m, 'returned');
    this.resendPrivate(playerId);
  }

  /** B-21: 복귀하면 내 비밀 숫자와 현재 차례를 다시 보낸다 */
  resendPrivate(playerId: string): void {
    const m = this.#members.get(playerId);
    if (!m) return;
    if (m.secret && m.seat !== null && this.#inGame())
      this.#io.sendTo(m.id, 'your_secret', { digits: m.secret });
    if (this.phase === 'PLAYING' && this.state.currentTurn)
      this.#io.sendTo(playerId, 'turn_start', {
        playerId: this.state.currentTurn,
        turnId: this.#turnId,
        deadline: this.state.deadline,
        serverNow: this.#scheduler.now(),
        lastChance: this.state.lastChance,
      });
  }

  /** B-34: 게임 중 나가면 봇이 이어서 추측한다 */
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
      m.view.autopilot = false;
      m.view.connected = true;
      this.#notifyReplaced(m, 'left');
      if (this.phase === 'SECRET' && !m.secret) this.#setSecret(m, this.#randomSecret());
      else if (this.phase === 'PLAYING' && this.#game && this.#game.turn === m.seat)
        this.#scheduleBot(this.#turnId);
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
        return this.#setOptionsMsg(m, body);
      case 'add_bot':
        return this.#addBot(m);
      case 'remove_bot':
        return this.#removeBot(m, body);
      case 'kick_player':
        return this.#kickPlayer(m, body);
      case 'start_game':
        return this.#startGame(m);
      case 'set_secret':
      case 'random_secret':
        return this.#secretMsg(m, type, body);
      case 'guess':
        return this.#guess(m, body);
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

  #setOptionsMsg(m: Member, body: Record<string, unknown>): HandleResult {
    if (this.phase !== 'WAITING') return fail('INVALID_STATE', '대기실에서만 옵션을 바꿀 수 있습니다.');
    if (this.state.hostId !== m.id) return fail('NOT_HOST', '방장만 옵션을 바꿀 수 있습니다.');
    const parsed = bulls.parseBullsOptions(body.options, this.#options);
    if (!parsed.ok) return fail('INVALID_OPTIONS', '옵션 값이 올바르지 않습니다.');
    this.#options = parsed.options;
    this.#writeOptions();
    this.#updateListing();
    return OK;
  }

  #addBot(m: Member): HandleResult {
    if (this.phase !== 'WAITING') return fail('INVALID_STATE', '대기실에서만 봇을 추가할 수 있습니다.');
    if (this.state.hostId !== m.id) return fail('NOT_HOST', '방장만 봇을 추가할 수 있습니다.');
    if (this.#seated().length >= bulls.BULLS_PLAYERS) return fail('ROOM_FULL', '자리가 없습니다.');
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

  /** E-15와 같다 */
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
    if (seated.length < bulls.BULLS_PLAYERS) {
      if (!this.#options.fillWithBots) return fail('NOT_ENOUGH_PLAYERS', '2명이 필요합니다.');
      while (this.#seated().length < bulls.BULLS_PLAYERS) this.#addBotMember();
    }
    this.state.phase = 'STARTING';
    this.#updateListing();
    this.state.phaseEndsAt = this.#scheduler.now() + this.#timing.startCountdownMs;
    this.#cancelPhase = this.#scheduler.after(this.#timing.startCountdownMs, () => {
      this.#cancelPhase = null;
      this.#beginSecret();
    });
    return OK;
  }

  // ───────────────────────── 비밀 숫자 (B-30) ─────────────────────────

  /** B-06: 선공은 무작위. 자리 0이 선공 */
  #beginSecret(): void {
    const seated = this.#seated().sort((a, b) => a.joinOrder - b.joinOrder);
    const firstIndex = this.#rng.int(2);
    const order = firstIndex === 0 ? seated : [...seated].reverse();
    order.forEach((p, i) => {
      p.seat = i as Seat;
      p.secret = '';
      p.consecutiveTimeouts = 0;
      if (p.controller === 'autopilot') p.controller = 'human';
      Object.assign(p.view, { seat: i, secretSet: false, attempts: 0, revealed: '', autopilot: false });
    });
    this.#gameId = this.#rng.id();
    this.#startedAt = new Date(this.#scheduler.now());
    this.#replacedIds.clear();
    this.#skipped = 0;
    this.#hadLastChance = false;
    this.state.history.clear();
    this.state.result = '';
    this.state.winnerId = '';
    this.state.lastChance = false;
    this.state.phase = 'SECRET';
    const ms = bulls.SECRET_MS * (this.#timing.msPerTurnSecond / 1000);
    this.state.phaseEndsAt = this.#scheduler.now() + ms;
    // 봇은 바로 정한다 (B-36)
    for (const p of order) if (p.controller !== 'human') this.#setSecret(p, this.#randomSecret());
    if (this.phase !== 'SECRET') return;
    this.#cancelPhase = this.#scheduler.after(ms, () => {
      this.#cancelPhase = null;
      for (const p of this.#players()) if (!p.secret) this.#setSecret(p, this.#randomSecret());
    });
  }

  #secretMsg(m: Member, type: 'set_secret' | 'random_secret', body: Record<string, unknown>): HandleResult {
    if (this.phase !== 'SECRET' || m.seat === null || m.spectator)
      return fail('INVALID_STATE', '지금은 비밀 숫자를 정할 수 없습니다.');
    if (m.secret) return fail('INVALID_STATE', '이미 비밀 숫자를 정했습니다.');
    let digits: string;
    if (type === 'random_secret') digits = this.#randomSecret();
    else {
      if (!bulls.isValidNumber(body.digits, this.#options.digits))
        return fail('INVALID_GUESS', MESSAGES.INVALID_GUESS);
      digits = body.digits;
    }
    this.#setSecret(m, digits);
    return OK;
  }

  #setSecret(m: Member, digits: string): void {
    if (this.phase !== 'SECRET' || m.secret) return;
    m.secret = digits;
    m.view.secretSet = true;
    this.#io.sendTo(m.id, 'your_secret', { digits });
    const players = this.#players();
    if (players.length === bulls.BULLS_PLAYERS && players.every((p) => p.secret)) this.#beginPlay();
  }

  #beginPlay(): void {
    this.#cancelPhase?.();
    this.#cancelPhase = null;
    const [a, b] = this.#players().sort((x, y) => (x.seat ?? 0) - (y.seat ?? 0));
    if (!a || !b) return;
    this.#game = bulls.startBulls(this.#options.digits, this.#options.maxAttempts, [a.secret, b.secret]);
    this.state.phase = 'PLAYING';
    this.state.phaseEndsAt = 0;
    this.#startTurn();
  }

  // ───────────────────────── 추측 ─────────────────────────

  #startTurn(): void {
    this.#clearTurnTimers();
    const g = this.#game;
    if (!g || g.over) return;
    const player = this.#bySeat(g.turn);
    if (!player) return;
    this.#turnId = this.#rng.id();
    const deadline = this.#scheduler.now() + this.#options.turnSeconds * this.#timing.msPerTurnSecond;
    this.state.currentTurn = player.id;
    this.state.turnId = this.#turnId;
    this.state.deadline = deadline;
    this.state.lastChance = g.lastChance;
    this.#io.broadcast('turn_start', {
      playerId: player.id,
      turnId: this.#turnId,
      deadline,
      serverNow: this.#scheduler.now(),
      lastChance: g.lastChance,
    });
    const turnId = this.#turnId;
    this.#cancelTurn = this.#scheduler.after(deadline - this.#scheduler.now(), () => {
      this.#cancelTurn = null;
      this.#onTimeout(turnId);
    });
    if (player.controller !== 'human') this.#scheduleBot(turnId);
  }

  /** B-31, B-32: 그 턴을 넘긴다 (시도 1회). 2번 연속이면 봇이 대신 */
  #onTimeout(turnId: string): void {
    const g = this.#game;
    if (!g || this.phase !== 'PLAYING' || turnId !== this.#turnId) return;
    const m = this.#bySeat(g.turn);
    if (!m) return;
    if (m.controller === 'human') {
      m.consecutiveTimeouts += 1;
      if (m.consecutiveTimeouts >= 2) {
        m.controller = 'autopilot';
        m.view.autopilot = true;
      }
    }
    this.#skipped += 1;
    this.#apply(m, bulls.skipTurn(g, g.turn), true);
  }

  #scheduleBot(turnId: string): void {
    this.#cancelBot?.();
    const span = Math.max(0, this.#timing.botDelayMaxMs - this.#timing.botDelayMinMs);
    const delay = this.#timing.botDelayMinMs + (span > 0 ? this.#rng.int(span + 1) : 0);
    this.#cancelBot = this.#scheduler.after(delay, () => {
      this.#cancelBot = null;
      const g = this.#game;
      if (!g || this.phase !== 'PLAYING' || this.#turnId !== turnId) return;
      const m = this.#bySeat(g.turn);
      if (!m || m.controller === 'human') return;
      // B-35: 자기 추측 기록만 쓴다 (상대 비밀 숫자는 보지 않는다)
      const own = g.history.filter((r) => r.seat === g.turn);
      const digits = bulls.botGuess(g.digits, own, (n) => this.#rng.int(n));
      this.#apply(m, bulls.guessNumber(g, g.turn, digits), true);
    });
  }

  /** BE-01~BE-03 */
  #guess(m: Member, body: Record<string, unknown>): HandleResult {
    const g = this.#game;
    if (!g || this.phase !== 'PLAYING') return fail('INVALID_STATE', '게임 중이 아닙니다.');
    if (m.spectator || m.seat === null || m.controller === 'bot' || g.turn !== m.seat)
      return fail('NOT_YOUR_TURN', '내 차례가 아닙니다.');
    if (body.turnId !== this.#turnId) return fail('STALE_TURN', '이미 지난 차례입니다.');
    const result = bulls.guessNumber(g, m.seat, body.digits);
    if (!result.ok) return fail(result.code, MESSAGES[result.code]);
    m.consecutiveTimeouts = 0;
    if (m.controller === 'autopilot') {
      m.controller = 'human';
      m.view.autopilot = false;
    }
    this.#apply(m, result, false);
    return OK;
  }

  #apply(m: Member, result: bulls.BullsResult, isAuto: boolean): void {
    if (!result.ok) return;
    this.#clearTurnTimers();
    const before = this.#game;
    this.#game = result.state;
    const r = result.record;
    const attempt = result.state.attempts[r.seat];
    m.view.attempts = attempt;
    this.state.history.push(
      new BullsGuessState({
        playerId: m.id,
        guess: r.guess ?? '',
        strikes: r.strikes,
        balls: r.balls,
        skipped: r.guess === null,
        isAuto: isAuto || m.controller !== 'human',
      }),
    );
    if (r.guess === null) this.#io.broadcast('turn_skipped', { playerId: m.id, attempt });
    else
      this.#io.broadcast('guess_result', {
        playerId: m.id,
        guess: r.guess,
        strikes: r.strikes,
        balls: r.balls,
        attempt,
        isAuto: isAuto || m.controller !== 'human',
      });
    if (result.state.lastChance && !before?.lastChance) {
      this.#hadLastChance = true;
      const second = this.#bySeat(1);
      if (second) this.#io.broadcast('last_chance', { playerId: second.id });
    }
    if (result.state.over) {
      this.#finish();
      return;
    }
    this.#startTurn();
  }

  // ───────────────────────── 끝 / 리매치 ─────────────────────────

  #finish(): void {
    const g = this.#game;
    if (!g || !g.result) return;
    this.#clearTurnTimers();
    const winner = g.winner === null ? undefined : this.#bySeat(g.winner);
    this.state.currentTurn = '';
    this.state.turnId = '';
    this.state.deadline = 0;
    this.state.lastChance = false;
    this.state.result = g.result;
    this.state.winnerId = winner?.id ?? '';
    const players = this.#players();
    // B-23: 끝나면 두 비밀 숫자를 공개한다
    for (const p of players) p.view.revealed = p.secret;
    this.state.phase = 'GAME_OVER';
    this.#io.broadcast('game_over', {
      result: g.result,
      winnerId: winner?.id ?? null,
      secrets: Object.fromEntries(players.map((p) => [p.id, p.secret])),
      attempts: Object.fromEntries(players.map((p) => [p.id, g.attempts[p.seat ?? 0]])),
    });
    this.#io.onFinished?.({
      gameId: this.#gameId,
      roomCode: this.state.roomCode,
      startedAt: this.#startedAt,
      endedAt: new Date(this.#scheduler.now()),
      options: this.#options,
      players: players.map((p) => ({
        guestId: p.guestId,
        nickname: p.nickname,
        seat: p.seat ?? 0,
        attempts: g.attempts[p.seat ?? 0],
        isBot: p.originallyBot,
        replaced: this.#replacedIds.has(p.id),
      })),
      result: g.result,
      winnerSeat: g.winner,
      lastChance: this.#hadLastChance,
      skippedTurns: this.#skipped,
    });
  }

  /** B-10: 같은 방 대기실로. 나간 사람 자리는 정리한다 */
  #rematch(m: Member): HandleResult {
    if (this.phase !== 'GAME_OVER') return fail('INVALID_STATE', '게임이 끝난 뒤에만 다시 할 수 있습니다.');
    if (!m.present) return fail('INVALID_STATE', '방에 없습니다.');
    for (const x of [...this.#members.values()]) {
      if (!x.originallyBot && !x.present) {
        this.#removeMember(x);
        continue;
      }
      x.seat = null;
      x.secret = '';
      x.spectator = false;
      x.consecutiveTimeouts = 0;
      if (x.controller === 'autopilot') x.controller = 'human';
      x.ready = x.originallyBot || x.id === this.state.hostId;
      Object.assign(x.view, {
        seat: -1,
        secretSet: false,
        attempts: 0,
        revealed: '',
        spectator: false,
        autopilot: false,
        ready: x.ready,
      });
    }
    const seated = this.#seated().sort(
      (a, b) => Number(a.originallyBot) - Number(b.originallyBot) || a.joinOrder - b.joinOrder,
    );
    seated.slice(bulls.BULLS_PLAYERS).forEach((x) => {
      if (x.originallyBot) this.#removeMember(x);
      else {
        x.spectator = true;
        x.view.spectator = true;
      }
    });
    this.#game = null;
    this.state.history.clear();
    this.state.result = '';
    this.state.winnerId = '';
    this.state.phase = 'WAITING';
    this.#updateListing();
    return OK;
  }

  // ───────────────────────── 보조 ─────────────────────────

  #randomSecret(): string {
    return bulls.randomNumber(this.#options.digits, (n) => this.#rng.int(n));
  }

  #inGame(): boolean {
    return this.phase === 'SECRET' || this.phase === 'PLAYING';
  }

  #notifyReplaced(m: Member, reason: bulls.ReplaceReason): void {
    this.#io.broadcast('player_replaced', { playerId: m.id, nickname: m.nickname, reason });
  }

  #checkAbandoned(): void {
    const humans = [...this.#members.values()].filter((m) => m.present && m.controller !== 'bot');
    const seatedHumans = humans.filter((m) => !m.spectator);
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

  /** 자리에 앉은 두 사람 (게임 중) */
  #players(): Member[] {
    return [...this.#members.values()].filter((m) => !m.spectator && m.seat !== null);
  }

  #bySeat(seat: Seat): Member | undefined {
    return this.#players().find((m) => m.seat === seat);
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
    const view = new BullsPlayerState({
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
      seat: null,
      secret: '',
      consecutiveTimeouts: 0,
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
    Object.assign(this.state.options, this.#options);
  }

  #updateListing(): void {
    const listed =
      !this.#options.isPrivate && this.phase === 'WAITING' && this.#seated().length < bulls.BULLS_PLAYERS;
    if (listed !== this.#listed) {
      this.#listed = listed;
      this.#io.onListingChange(listed);
    }
  }

  #clearTurnTimers(): void {
    this.#cancelTurn?.();
    this.#cancelBot?.();
    this.#cancelTurn = null;
    this.#cancelBot = null;
  }
}
