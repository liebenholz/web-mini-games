import { normalizeNickname, oneCard, type ErrorCode } from '@wmg/rules';
import type { Rng } from '../../framework/rng.js';
import type { Scheduler } from '../../framework/scheduler.js';
import type { Timing } from '../liars-dice/LiarsDiceMatch.js';
import { OneCardPlayerState, OneCardState } from './state.js';

type Options = oneCard.OneCardRoomOptions;
type Phase = oneCard.OneCardPhase;
type Card = oneCard.Card;
type ServerMessages = oneCard.OneCardServerMessages;
type ServerMessageType = oneCard.OneCardServerMessageType;

export const ONE_CARD_SPECTATOR_LIMIT = 20;

/** 엔진 → 네트워크. 방 어댑터(OneCardRoom)가 구현한다 */
export interface OneCardIO {
  broadcast<T extends ServerMessageType>(type: T, payload: ServerMessages[T]): void;
  sendTo<T extends ServerMessageType>(playerId: string, type: T, payload: ServerMessages[T]): void;
  /** 사람이 모두 나갔다. 방을 닫는다 (기록하지 않음, CE-08) */
  onAbandoned(): void;
  onListingChange(listed: boolean): void;
  onKick(playerId: string): void;
  onFinished?(record: OneCardRecord): void;
}

export interface OneCardRecord {
  readonly gameId: string;
  readonly roomCode: string;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly options: Options;
  readonly players: readonly {
    readonly guestId: string | null;
    readonly nickname: string;
    readonly seat: number;
    readonly rank: number;
    readonly bankrupt: boolean;
    readonly isBot: boolean;
    readonly replaced: boolean;
  }[];
  readonly turnCount: number;
  readonly maxAttack: number;
  readonly penaltyCount: number;
}

export interface OneCardDeps {
  readonly io: OneCardIO;
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

const MESSAGES: Record<oneCard.OneCardErrorCode, string> = {
  NOT_YOUR_TURN: '내 차례가 아닙니다.',
  INVALID_CARD: '지금 낼 수 없는 카드입니다.',
  INVALID_SUIT: '모양을 다시 골라 주세요.',
  INVALID_STATE: '지금은 할 수 없습니다.',
};

interface Member {
  readonly id: string;
  readonly guestId: string | null;
  readonly nickname: string;
  readonly joinOrder: number;
  readonly originallyBot: boolean;
  /** autopilot = 시간 초과 2번으로 봇이 대신 (C-52), bot = 봇 또는 나간 사람 자리 (C-55) */
  controller: 'human' | 'autopilot' | 'bot';
  present: boolean;
  spectator: boolean;
  ready: boolean;
  seat: number;
  consecutiveTimeouts: number;
  readonly view: OneCardPlayerState;
}

interface OneCardWindow {
  readonly id: string;
  readonly seat: number;
  cancel: () => void;
  cancelBot: (() => void) | null;
}

/**
 * 원카드 한 방의 진행 (docs/specs/one-card.md). 규칙은 @wmg/rules의 oneCard 엔진이 판정하고,
 * 여기서는 시간(턴, 원카드 창), 봇, 정보 은닉(패는 본인에게만), 대기실을 맡는다.
 */
export class OneCardMatch {
  readonly state = new OneCardState();
  readonly #io: OneCardIO;
  readonly #rng: Rng;
  readonly #scheduler: Scheduler;
  readonly #timing: Timing;
  #options: Options;
  #members = new Map<string, Member>();
  #byGuest = new Map<string, string>();
  #bySeat = new Map<number, Member>();
  readonly #kicked = new Set<string>();
  #game: oneCard.OneCardState | null = null;
  #window: OneCardWindow | null = null;
  #gameId = '';
  #startedAt = new Date(0);
  /** ST-08: 이번 판에서 봇이 자리를 이어받은 사람 (돌아와도 남긴다) */
  readonly #replacedIds = new Set<string>();
  #turnCount = 0;
  #maxAttack = 0;
  #penaltyCount = 0;
  #turnId = '';
  #cancelTurn: (() => void) | null = null;
  #cancelBot: (() => void) | null = null;
  #cancelPhase: (() => void) | null = null;
  #joinCounter = 0;
  #botCounter = 0;
  #listed = false;
  #disposed = false;

  constructor(roomCode: string, options: Options, deps: OneCardDeps) {
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

  get options(): Options {
    return this.#options;
  }

  /** 테스트용: 서버만 아는 진행 상태 */
  get game(): oneCard.OneCardState | null {
    return this.#game;
  }

  /**
   * 테스트 전용: 진행 중인 판을 정해진 상태로 바꾸고 그 차례를 새로 시작한다.
   * 네트워크 메시지(handle)로는 부를 수 없다. 특정 패 상황(원카드 창, 파산)을 재현하는 데만 쓴다
   */
  replaceGameForTest(game: oneCard.OneCardState): void {
    if (this.phase !== 'PLAYING') throw new Error('not playing');
    this.#game = game;
    this.#sync();
    for (const p of this.#bySeat.values()) this.#sendHand(p);
    this.#startTurn();
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
      if (this.#seated().length >= this.#options.maxPlayers) return { ok: false, code: 'ROOM_FULL' };
    } else {
      // CE-09: 게임 중 입장은 관전자
      if (this.#spectators().length >= ONE_CARD_SPECTATOR_LIMIT) return { ok: false, code: 'ROOM_FULL' };
      spectator = true;
    }
    const member = this.#addMember({ guestId, nickname, bot: false, spectator });
    if (!this.state.hostId) this.#setHost(member);
    this.#updateListing();
    return { ok: true, playerId: member.id, role: spectator ? 'spectator' : 'player', reclaimed: false };
  }

  /** C-54: 연결 끊김. 자리는 유지하고 알린다. 그사이 차례가 오면 시간 초과 처리 */
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

  /** 복귀하면 내 패와 현재 차례를 다시 보낸다 */
  resendPrivate(playerId: string): void {
    const m = this.#members.get(playerId);
    if (!m || this.phase !== 'PLAYING' || !this.#game) return;
    if (m.seat >= 0) this.#sendHand(m);
    if (this.state.currentTurn)
      this.#io.sendTo(playerId, 'turn_start', {
        playerId: this.state.currentTurn,
        turnId: this.#turnId,
        deadline: this.state.deadline,
        serverNow: this.#scheduler.now(),
        attack: this.#game.attack,
      });
  }

  /** C-55: 게임 중 나가면 봇이 패를 이어받는다 */
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
      if (this.phase === 'PLAYING' && this.#game) {
        if (this.#window && this.#window.seat === m.seat) this.#scheduleWindowBot();
        else if (!this.#window && this.#game.turn === m.seat) this.#scheduleBot(this.#turnId);
      }
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
      case 'play':
      case 'draw':
      case 'pass':
        return this.#turnAction(m, type, body);
      case 'call_one_card':
        return this.#callOneCard(m, body);
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
    const parsed = oneCard.parseOneCardOptions(body.options, this.#options);
    if (!parsed.ok) return fail('INVALID_OPTIONS', '옵션 값이 올바르지 않습니다.');
    if (parsed.options.maxPlayers < this.#seated().length)
      return fail('INVALID_OPTIONS', '지금 인원보다 적게 줄일 수 없습니다.');
    this.#options = parsed.options;
    this.#writeOptions();
    this.#updateListing();
    return OK;
  }

  #addBot(m: Member): HandleResult {
    if (this.phase !== 'WAITING') return fail('INVALID_STATE', '대기실에서만 봇을 추가할 수 있습니다.');
    if (this.state.hostId !== m.id) return fail('NOT_HOST', '방장만 봇을 추가할 수 있습니다.');
    if (this.#seated().length >= this.#options.maxPlayers) return fail('ROOM_FULL', '자리가 없습니다.');
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
    if (seated.length < 2) {
      if (!this.#options.fillWithBots) return fail('NOT_ENOUGH_PLAYERS', '2명 이상이 필요합니다.');
    }
    if (this.#options.fillWithBots)
      while (this.#seated().length < this.#options.maxPlayers) this.#addBotMember();
    this.state.phase = 'STARTING';
    this.#updateListing();
    this.state.phaseEndsAt = this.#scheduler.now() + this.#timing.startCountdownMs;
    this.#cancelPhase = this.#scheduler.after(this.#timing.startCountdownMs, () => {
      this.#cancelPhase = null;
      this.#beginGame();
    });
    return OK;
  }

  /** C-01~C-05: 입장 순서로 좌석, 섞고 나눠 주고 첫 카드, 첫 차례 무작위 */
  #beginGame(): void {
    const seated = this.#seated().sort((a, b) => a.joinOrder - b.joinOrder);
    this.#bySeat.clear();
    seated.forEach((p, seat) => {
      p.seat = seat;
      p.consecutiveTimeouts = 0;
      if (p.controller === 'autopilot') p.controller = 'human';
      Object.assign(p.view, { seat, status: 'playing', rank: 0, autopilot: false });
      this.#bySeat.set(seat, p);
    });
    this.#gameId = this.#rng.id();
    this.#startedAt = new Date(this.#scheduler.now());
    this.#replacedIds.clear();
    this.#turnCount = 0;
    this.#maxAttack = 0;
    this.#penaltyCount = 0;
    this.#game = oneCard.startOneCard(
      this.#shuffle(oneCard.fullDeck()),
      seated.length,
      this.#rng.int(seated.length),
    );
    this.state.phase = 'PLAYING';
    this.state.phaseEndsAt = 0;
    this.#sync();
    for (const p of seated) this.#sendHand(p);
    this.#startTurn();
  }

  // ───────────────────────── 차례 ─────────────────────────

  #startTurn(): void {
    this.#clearTurnTimers();
    const g = this.#game;
    if (!g || g.over || this.#window) return;
    const player = this.#bySeat.get(g.turn);
    if (!player) return;
    this.#turnCount += 1;
    this.#turnId = this.#rng.id();
    this.state.currentTurn = player.id;
    this.state.turnId = this.#turnId;
    this.#setDeadline(this.#scheduler.now() + this.#options.turnSeconds * this.#timing.msPerTurnSecond);
    if (player.controller !== 'human') this.#scheduleBot(this.#turnId);
  }

  /** 마감 시각을 정하고 타이머를 건다. 같은 turnId로 turn_start를 다시 보낸다 */
  #setDeadline(deadline: number): void {
    this.#cancelTurn?.();
    this.state.deadline = deadline;
    const turnId = this.#turnId;
    this.#io.broadcast('turn_start', {
      playerId: this.state.currentTurn,
      turnId,
      deadline,
      serverNow: this.#scheduler.now(),
      attack: this.#game?.attack ?? 0,
    });
    this.#cancelTurn = this.#scheduler.after(Math.max(0, deadline - this.#scheduler.now()), () => {
      this.#cancelTurn = null;
      this.#onTimeout(turnId);
    });
  }

  /** C-51, C-52: 자동으로 가져오고 넘긴다. 2번 연속이면 봇이 대신 둔다 */
  #onTimeout(turnId: string): void {
    const g = this.#game;
    if (!g || this.phase !== 'PLAYING' || turnId !== this.#turnId || this.#window) return;
    const m = this.#bySeat.get(g.turn);
    if (!m) return;
    if (m.controller === 'human') {
      m.consecutiveTimeouts += 1;
      if (m.consecutiveTimeouts >= 2) {
        m.controller = 'autopilot';
        m.view.autopilot = true;
      }
    }
    this.#apply(m, oneCard.autoAction(g, m.seat, this.#env), true);
  }

  #scheduleBot(turnId: string): void {
    this.#cancelBot?.();
    const span = Math.max(0, this.#timing.botDelayMaxMs - this.#timing.botDelayMinMs);
    const delay = this.#timing.botDelayMinMs + (span > 0 ? this.#rng.int(span + 1) : 0);
    this.#cancelBot = this.#scheduler.after(delay, () => {
      this.#cancelBot = null;
      const g = this.#game;
      if (!g || this.phase !== 'PLAYING' || this.#turnId !== turnId || this.#window) return;
      const m = this.#bySeat.get(g.turn);
      if (!m || m.controller === 'human') return;
      const hand = g.hands[m.seat] ?? [];
      const action = oneCard.oneCardBotAction(g, hand);
      const result =
        action.type === 'play'
          ? oneCard.playCard(g, m.seat, action.card, action.suit ?? undefined)
          : action.type === 'draw'
            ? oneCard.drawCards(g, m.seat, this.#env)
            : oneCard.passTurn(g, m.seat);
      this.#apply(m, result, true);
    });
  }

  /** CE-01~CE-06, CE-10 */
  #turnAction(m: Member, type: 'play' | 'draw' | 'pass', body: Record<string, unknown>): HandleResult {
    const g = this.#game;
    if (!g || this.phase !== 'PLAYING') return fail('INVALID_STATE', '게임 중이 아닙니다.');
    if (m.spectator || m.seat < 0) return fail('NOT_YOUR_TURN', '내 차례가 아닙니다.');
    if (this.#window) return fail('INVALID_STATE', '원카드 판정이 끝난 뒤에 할 수 있습니다.');
    if (g.turn !== m.seat || m.controller === 'bot') return fail('NOT_YOUR_TURN', '내 차례가 아닙니다.');
    if (body.turnId !== this.#turnId) return fail('STALE_TURN', '이미 지난 차례입니다.');
    let result: oneCard.OneCardResult;
    if (type === 'play') {
      if (!oneCard.isCard(body.card)) return fail('INVALID_CARD', MESSAGES.INVALID_CARD);
      result = oneCard.playCard(g, m.seat, body.card, body.suit);
    } else if (type === 'draw') {
      result = oneCard.drawCards(g, m.seat, this.#env);
    } else {
      result = oneCard.passTurn(g, m.seat);
    }
    if (!result.ok) return fail(result.code, MESSAGES[result.code]);
    // S-07과 같다: 직접 두면 자동 진행을 돌려받는다
    m.consecutiveTimeouts = 0;
    if (m.controller === 'autopilot') {
      m.controller = 'human';
      m.view.autopilot = false;
    }
    this.#apply(m, result, false);
    return OK;
  }

  /** 엔진 결과를 반영한다: 알림, 공유 상태, 패 전송, 원카드 창, 다음 차례 */
  #apply(m: Member, result: oneCard.OneCardResult, isAuto: boolean): void {
    if (!result.ok) return;
    const before = this.#game;
    this.#game = result.state;
    this.#clearTurnTimers();
    const touched = new Set<number>();
    let windowSeat: number | null = null;
    for (const e of result.events) {
      switch (e.type) {
        case 'played': {
          const p = this.#bySeat.get(e.seat);
          if (!p) break;
          touched.add(e.seat);
          this.#io.broadcast('card_played', {
            playerId: p.id,
            card: e.card,
            suit: e.suit,
            left: result.state.hands[e.seat]?.length ?? 0,
            isAuto: isAuto || p.controller !== 'human',
          });
          break;
        }
        case 'drew': {
          const p = this.#bySeat.get(e.seat);
          if (!p) break;
          touched.add(e.seat);
          if (e.reason === 'penalty') this.#penaltyCount += 1;
          // C-42: 장수만 모두에게
          this.#io.broadcast('cards_drawn', { playerId: p.id, count: e.cards.length, reason: e.reason });
          break;
        }
        case 'one_card':
          windowSeat = e.seat;
          break;
        case 'finished': {
          const p = this.#bySeat.get(e.seat);
          if (!p) break;
          p.view.status = 'finished';
          p.view.rank = e.rank;
          this.#io.broadcast('player_finished', { playerId: p.id, rank: e.rank });
          break;
        }
        case 'bankrupt': {
          const p = this.#bySeat.get(e.seat);
          if (!p) break;
          touched.add(e.seat);
          p.view.status = 'bankrupt';
          this.#io.broadcast('player_bankrupt', { playerId: p.id });
          break;
        }
        case 'reshuffled':
        case 'game_over':
          break;
      }
    }
    this.#maxAttack = Math.max(this.#maxAttack, result.state.attack);
    this.#sync();
    for (const seat of touched) {
      const p = this.#bySeat.get(seat);
      if (p) this.#sendHand(p);
    }
    if (result.state.over) {
      this.#finish();
      return;
    }
    if (windowSeat !== null) {
      this.#openWindow(windowSeat);
      return;
    }
    // 가져온 카드를 낼 수 있어 같은 차례가 이어진다 (C-14, C-53)
    if (result.state.drawn !== null && before && result.state.turn === m.seat) {
      const min =
        this.#scheduler.now() + oneCard.MIN_TIME_AFTER_DRAW_MS * (this.#timing.msPerTurnSecond / 1000);
      this.#setDeadline(Math.max(this.state.deadline, min));
      if (m.controller !== 'human') this.#scheduleBot(this.#turnId);
      return;
    }
    this.#startTurn();
  }

  // ───────────────────────── 원카드 창 (C-30~C-32, C-57) ─────────────────────────

  #openWindow(seat: number): void {
    const target = this.#bySeat.get(seat);
    if (!target) return;
    const ms = oneCard.ONE_CARD_WINDOW_MS * (this.#timing.msPerTurnSecond / 1000);
    const id = this.#rng.id();
    const closesAt = this.#scheduler.now() + ms;
    // C-32: 창이 열린 동안 차례를 시작하지 않는다
    this.state.currentTurn = '';
    this.state.turnId = '';
    this.state.deadline = 0;
    this.#turnId = '';
    this.state.windowId = id;
    this.state.windowTarget = target.id;
    this.state.windowClosesAt = closesAt;
    this.#window = {
      id,
      seat,
      cancel: this.#scheduler.after(ms, () => this.#closeWindow(null)),
      cancelBot: null,
    };
    this.#io.broadcast('one_card_window', { windowId: id, playerId: target.id, closesAt });
    if (target.controller !== 'human') this.#scheduleWindowBot();
  }

  /** C-57: 봇(또는 나간 사람 자리)은 자기 창을 1~2초 사이에 누른다 */
  #scheduleWindowBot(): void {
    const w = this.#window;
    if (!w) return;
    w.cancelBot?.();
    const unit = this.#timing.msPerTurnSecond;
    const delay = unit + this.#rng.int(unit + 1);
    w.cancelBot = this.#scheduler.after(delay, () => {
      if (this.#window !== w) return;
      const target = this.#bySeat.get(w.seat);
      if (target) this.#closeWindow(target);
    });
  }

  #callOneCard(m: Member, body: Record<string, unknown>): HandleResult {
    const w = this.#window;
    if (!w || body.windowId !== w.id) return fail('STALE_TURN', '이미 끝난 원카드 판정입니다.');
    if (m.spectator || m.seat < 0 || m.view.status !== 'playing')
      return fail('INVALID_STATE', '지금은 누를 수 없습니다.');
    this.#closeWindow(m);
    return OK;
  }

  /** C-31: 먼저 누른 쪽 하나만 처리하고 바로 닫는다. caller가 null이면 시간이 다 됐다 */
  #closeWindow(caller: Member | null): void {
    const w = this.#window;
    const g = this.#game;
    if (!w || !g) return;
    this.#window = null;
    w.cancel();
    w.cancelBot?.();
    this.state.windowId = '';
    this.state.windowTarget = '';
    this.state.windowClosesAt = 0;
    const target = this.#bySeat.get(w.seat);
    if (!target) return;
    const result: 'safe' | 'penalty' | 'expired' = !caller
      ? 'expired'
      : caller === target
        ? 'safe'
        : 'penalty';
    this.#io.broadcast('one_card_called', {
      windowId: w.id,
      callerId: caller?.id ?? null,
      playerId: target.id,
      result,
    });
    if (result === 'penalty') {
      const r = oneCard.penaltyDraw(g, w.seat, this.#env);
      if (r.ok) {
        this.#apply(target, r, false);
        return;
      }
    }
    this.#startTurn();
  }

  // ───────────────────────── 끝 / 리매치 ─────────────────────────

  #finish(): void {
    const g = this.#game;
    if (!g) return;
    this.#clearTurnTimers();
    this.state.currentTurn = '';
    this.state.turnId = '';
    this.state.deadline = 0;
    this.state.phase = 'GAME_OVER';
    const ranking = oneCard.rankingOf(g);
    const rows = ranking.flatMap((seat, i) => {
      const p = this.#bySeat.get(seat);
      if (!p) return [];
      p.view.rank = i + 1;
      return [{ p, seat, rank: i + 1, bankrupt: g.status[seat] === 'bankrupt' }];
    });
    this.#io.broadcast('game_over', {
      ranking: rows.map((r) => ({ playerId: r.p.id, rank: r.rank, bankrupt: r.bankrupt })),
    });
    this.#io.onFinished?.({
      gameId: this.#gameId,
      roomCode: this.state.roomCode,
      startedAt: this.#startedAt,
      endedAt: new Date(this.#scheduler.now()),
      options: this.#options,
      players: rows.map((r) => ({
        guestId: r.p.guestId,
        nickname: r.p.nickname,
        seat: r.seat,
        rank: r.rank,
        bankrupt: r.bankrupt,
        isBot: r.p.originallyBot,
        replaced: this.#replacedIds.has(r.p.id),
      })),
      turnCount: this.#turnCount,
      maxAttack: this.#maxAttack,
      penaltyCount: this.#penaltyCount,
    });
  }

  /** C-37: 같은 방 대기실로. 나간 사람 자리는 정리한다 */
  #rematch(m: Member): HandleResult {
    if (this.phase !== 'GAME_OVER') return fail('INVALID_STATE', '게임이 끝난 뒤에만 다시 할 수 있습니다.');
    if (!m.present) return fail('INVALID_STATE', '방에 없습니다.');
    let seated = 0;
    const members = [...this.#members.values()].sort(
      (a, b) => Number(a.spectator) - Number(b.spectator) || a.joinOrder - b.joinOrder,
    );
    for (const x of members) {
      if (!x.originallyBot && !x.present) {
        this.#removeMember(x);
        continue;
      }
      if (seated >= this.#options.maxPlayers) {
        if (x.originallyBot) this.#removeMember(x);
        else {
          x.spectator = true;
          x.view.spectator = true;
        }
      } else {
        x.spectator = false;
        x.view.spectator = false;
        seated += 1;
      }
      if (x.controller === 'autopilot') x.controller = 'human';
      x.seat = -1;
      x.consecutiveTimeouts = 0;
      x.ready = x.originallyBot || x.id === this.state.hostId;
      Object.assign(x.view, {
        seat: -1,
        handCount: 0,
        status: '',
        rank: 0,
        autopilot: false,
        ready: x.ready,
      });
    }
    this.#bySeat.clear();
    this.#game = null;
    this.state.phase = 'WAITING';
    this.#sync();
    this.#updateListing();
    return OK;
  }

  // ───────────────────────── 보조 ─────────────────────────

  readonly #env: oneCard.OneCardEnv = { shuffle: (cards) => this.#shuffle(cards) };

  /** Fisher-Yates. 난수는 서버 rng(crypto)만 쓴다 (CLAUDE.md 원칙 5) */
  #shuffle(cards: readonly Card[]): Card[] {
    const a = [...cards];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = this.#rng.int(i + 1);
      [a[i], a[j]] = [a[j] as Card, a[i] as Card];
    }
    return a;
  }

  /** 공유 상태: 공개 정보만 (C-41) */
  #sync(): void {
    const g = this.#game;
    this.state.topCard = g ? oneCard.topCard(g) : '';
    this.state.chosenSuit = g?.chosenSuit ?? '';
    this.state.attack = g?.attack ?? 0;
    this.state.direction = g?.direction ?? 1;
    this.state.deckCount = g?.deck.length ?? 0;
    if (!g) return;
    for (const [seat, p] of this.#bySeat) p.view.handCount = g.hands[seat]?.length ?? 0;
  }

  /** C-40: 패는 본인에게만 */
  #sendHand(m: Member): void {
    const g = this.#game;
    if (!g || m.seat < 0 || m.controller === 'bot') return;
    this.#io.sendTo(m.id, 'your_hand', {
      cards: [...(g.hands[m.seat] ?? [])],
      drawn: g.turn === m.seat ? g.drawn : null,
    });
  }

  #notifyReplaced(m: Member, reason: oneCard.ReplaceReason): void {
    this.#io.broadcast('player_replaced', { playerId: m.id, nickname: m.nickname, reason });
  }

  #checkAbandoned(): void {
    const humans = [...this.#members.values()].filter((m) => m.present && m.controller !== 'bot');
    const seatedHumans = humans.filter((m) => !m.spectator);
    // CE-08: 게임 중 사람이 모두 나가면 방 종료, 기록하지 않음
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
    if (this.#window) {
      this.#window.cancel();
      this.#window.cancelBot?.();
      this.#window = null;
    }
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
    const view = new OneCardPlayerState({
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
      seat: -1,
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
      !this.#options.isPrivate &&
      this.phase === 'WAITING' &&
      this.#seated().length < this.#options.maxPlayers;
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
