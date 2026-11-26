import { oneCard } from '@wmg/rules';
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
import { shuffle, type Rng } from '../../framework/rng.js';
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
export interface OneCardIO extends LobbyIO {
  broadcast<T extends ServerMessageType>(type: T, payload: ServerMessages[T]): void;
  sendTo<T extends ServerMessageType>(playerId: string, type: T, payload: ServerMessages[T]): void;
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

export type { HandleResult, JoinResult } from '../../framework/game/LobbyMatch.js';

const MESSAGES: Record<oneCard.OneCardErrorCode, string> = {
  NOT_YOUR_TURN: '내 차례가 아닙니다.',
  INVALID_CARD: '지금 낼 수 없는 카드입니다.',
  INVALID_SUIT: '모양을 다시 골라 주세요.',
  INVALID_STATE: '지금은 할 수 없습니다.',
};

interface Member extends LobbyMember<OneCardPlayerState> {
  seat: number;
  consecutiveTimeouts: number;
}

interface OneCardWindow {
  readonly id: string;
  readonly seat: number;
  cancel: () => void;
  cancelBot: (() => void) | null;
}

/**
 * 원카드 한 방의 진행 (docs/specs/one-card.md). 규칙은 @wmg/rules의 oneCard 엔진이 판정하고,
 * 대기실·좌석·이탈·리매치는 LobbyMatch(ADR 0003)가 한다. 여기서는 시간(턴, 원카드 창), 봇,
 * 정보 은닉(패는 본인에게만)을 맡는다.
 */
export class OneCardMatch extends LobbyMatch<Options, OneCardPlayerState, Member, OneCardState, OneCardIO> {
  #bySeat = new Map<number, Member>();
  #game: oneCard.OneCardState | null = null;
  #window: OneCardWindow | null = null;
  #gameId = '';
  #startedAt = new Date(0);
  #turnCount = 0;
  #maxAttack = 0;
  #penaltyCount = 0;
  #turnId = '';

  constructor(roomCode: string, options: Options, deps: OneCardDeps) {
    super(new OneCardState(), roomCode, options, deps);
    this.writeOptions();
    this.updateListing();
  }

  override get phase(): Phase {
    return this.state.phase as Phase;
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

  // ───────────────────────── 대기실 훅 ─────────────────────────

  protected maxSeats(): number {
    return this.opts.maxPlayers;
  }

  protected spectatorLimit(): number {
    return ONE_CARD_SPECTATOR_LIMIT;
  }

  protected override notEnoughPlayersMessage(): string {
    return '2명 이상이 필요합니다.';
  }

  /** 지금 앉은 인원보다 정원을 줄일 수 없다 */
  protected override checkOptions(next: Options): string | null {
    return next.maxPlayers < this.seated().length ? '지금 인원보다 적게 줄일 수 없습니다.' : null;
  }

  /** C-37: 리매치는 앉아 있던 사람(봇 포함) 먼저, 그다음 들어온 순서 */
  protected override rematchOrder(a: Member, b: Member): number {
    return Number(a.spectator) - Number(b.spectator) || a.joinOrder - b.joinOrder;
  }

  protected createView(init: NewView): OneCardPlayerState {
    return new OneCardPlayerState({ ...init });
  }

  protected createMember(base: LobbyMember<OneCardPlayerState>): Member {
    return { ...base, seat: -1, consecutiveTimeouts: 0 };
  }

  protected parseOptions(input: unknown): { ok: true; options: Options } | { ok: false } {
    return oneCard.parseOneCardOptions(input, this.opts);
  }

  protected writeOptions(): void {
    Object.assign(this.state.options, this.opts);
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

  /** C-55: 게임 중 나가면 봇이 패를 이어받는다 */
  protected onSeatTakenOver(m: Member): void {
    m.view.replaced = true;
    m.view.autopilot = false;
    this.notifyReplaced(m, 'left');
    if (this.phase === 'PLAYING' && this.#game) {
      if (this.#window && this.#window.seat === m.seat) this.#scheduleWindowBot();
      else if (!this.#window && this.#game.turn === m.seat) this.#scheduleBot(this.#turnId);
    }
  }

  /** 복귀하면 내 패와 현재 차례를 다시 보낸다 */
  resendPrivate(playerId: string): void {
    const m = this.members.get(playerId);
    if (!m || this.phase !== 'PLAYING' || !this.#game) return;
    if (m.seat >= 0) this.#sendHand(m);
    if (this.state.currentTurn)
      this.io.sendTo(playerId, 'turn_start', {
        playerId: this.state.currentTurn,
        turnId: this.#turnId,
        deadline: this.state.deadline,
        serverNow: this.scheduler.now(),
        attack: this.#game.attack,
      });
  }

  protected handleGame(m: Member, type: string, body: Record<string, unknown>): HandleResult {
    switch (type) {
      case 'play':
      case 'draw':
      case 'pass':
        return this.#turnAction(m, type, body);
      case 'call_one_card':
        return this.#callOneCard(m, body);
      default:
        return fail('INVALID_MESSAGE', '알 수 없는 요청입니다.');
    }
  }

  protected resetMemberForRematch(x: Member): void {
    x.seat = -1;
    x.consecutiveTimeouts = 0;
    Object.assign(x.view, { seat: -1, handCount: 0, status: '', rank: 0, autopilot: false });
  }

  /** C-37: 같은 방 대기실로 */
  protected resetGameForRematch(): void {
    this.#bySeat.clear();
    this.#game = null;
    this.#sync();
  }

  override dispose(): void {
    if (this.disposed) return;
    super.dispose();
    if (this.#window) {
      this.#window.cancel();
      this.#window.cancelBot?.();
      this.#window = null;
    }
  }

  // ───────────────────────── 진행 ─────────────────────────

  /** C-01~C-05: 입장 순서로 좌석, 섞고 나눠 주고 첫 카드, 첫 차례 무작위 */
  protected beginGame(): void {
    const seated = this.seated().sort((a, b) => a.joinOrder - b.joinOrder);
    this.#bySeat.clear();
    seated.forEach((p, seat) => {
      p.seat = seat;
      p.consecutiveTimeouts = 0;
      if (p.controller === 'autopilot') p.controller = 'human';
      Object.assign(p.view, { seat, status: 'playing', rank: 0, autopilot: false });
      this.#bySeat.set(seat, p);
    });
    this.#gameId = this.rng.id();
    this.#startedAt = new Date(this.scheduler.now());
    this.replacedIds.clear();
    this.#turnCount = 0;
    this.#maxAttack = 0;
    this.#penaltyCount = 0;
    this.#game = oneCard.startOneCard(
      this.#shuffle(oneCard.fullDeck()),
      seated.length,
      this.rng.int(seated.length),
    );
    this.setPhase('PLAYING');
    this.state.phaseEndsAt = 0;
    this.#sync();
    for (const p of seated) this.#sendHand(p);
    this.#startTurn();
  }

  // ───────────────────────── 차례 ─────────────────────────

  #startTurn(): void {
    this.clearTurnTimers();
    const g = this.#game;
    if (!g || g.over || this.#window) return;
    const player = this.#bySeat.get(g.turn);
    if (!player) return;
    this.#turnCount += 1;
    this.#turnId = this.rng.id();
    this.state.currentTurn = player.id;
    this.state.turnId = this.#turnId;
    this.#setDeadline(this.scheduler.now() + this.opts.turnSeconds * this.timing.msPerTurnSecond);
    if (player.controller !== 'human') this.#scheduleBot(this.#turnId);
  }

  /** 마감 시각을 정하고 타이머를 건다. 같은 turnId로 turn_start를 다시 보낸다 */
  #setDeadline(deadline: number): void {
    this.state.deadline = deadline;
    const turnId = this.#turnId;
    this.io.broadcast('turn_start', {
      playerId: this.state.currentTurn,
      turnId,
      deadline,
      serverNow: this.scheduler.now(),
      attack: this.#game?.attack ?? 0,
    });
    this.setTurnTimer(Math.max(0, deadline - this.scheduler.now()), () => this.#onTimeout(turnId));
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
    this.setBotTimer(() => {
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
    this.clearTurnTimers();
    const touched = new Set<number>();
    let windowSeat: number | null = null;
    for (const e of result.events) {
      switch (e.type) {
        case 'played': {
          const p = this.#bySeat.get(e.seat);
          if (!p) break;
          touched.add(e.seat);
          this.io.broadcast('card_played', {
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
          this.io.broadcast('cards_drawn', { playerId: p.id, count: e.cards.length, reason: e.reason });
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
          this.io.broadcast('player_finished', { playerId: p.id, rank: e.rank });
          break;
        }
        case 'bankrupt': {
          const p = this.#bySeat.get(e.seat);
          if (!p) break;
          touched.add(e.seat);
          p.view.status = 'bankrupt';
          this.io.broadcast('player_bankrupt', { playerId: p.id });
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
        this.scheduler.now() + oneCard.MIN_TIME_AFTER_DRAW_MS * (this.timing.msPerTurnSecond / 1000);
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
    const ms = oneCard.ONE_CARD_WINDOW_MS * (this.timing.msPerTurnSecond / 1000);
    const id = this.rng.id();
    const closesAt = this.scheduler.now() + ms;
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
      cancel: this.scheduler.after(ms, () => this.#closeWindow(null)),
      cancelBot: null,
    };
    this.io.broadcast('one_card_window', { windowId: id, playerId: target.id, closesAt });
    if (target.controller !== 'human') this.#scheduleWindowBot();
  }

  /** C-57: 봇(또는 나간 사람 자리)은 자기 창을 1~2초 사이에 누른다 */
  #scheduleWindowBot(): void {
    const w = this.#window;
    if (!w) return;
    w.cancelBot?.();
    const unit = this.timing.msPerTurnSecond;
    const delay = unit + this.rng.int(unit + 1);
    w.cancelBot = this.scheduler.after(delay, () => {
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
    this.io.broadcast('one_card_called', {
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
    this.clearTurnTimers();
    this.state.currentTurn = '';
    this.state.turnId = '';
    this.state.deadline = 0;
    this.setPhase('GAME_OVER');
    const ranking = oneCard.rankingOf(g);
    const rows = ranking.flatMap((seat, i) => {
      const p = this.#bySeat.get(seat);
      if (!p) return [];
      p.view.rank = i + 1;
      return [{ p, seat, rank: i + 1, bankrupt: g.status[seat] === 'bankrupt' }];
    });
    this.io.broadcast('game_over', {
      ranking: rows.map((r) => ({ playerId: r.p.id, rank: r.rank, bankrupt: r.bankrupt })),
    });
    this.io.onFinished?.({
      gameId: this.#gameId,
      roomCode: this.state.roomCode,
      startedAt: this.#startedAt,
      endedAt: new Date(this.scheduler.now()),
      options: this.opts,
      players: rows.map((r) => ({
        guestId: r.p.guestId,
        nickname: r.p.nickname,
        seat: r.seat,
        rank: r.rank,
        bankrupt: r.bankrupt,
        isBot: r.p.originallyBot,
        replaced: this.replacedIds.has(r.p.id),
      })),
      turnCount: this.#turnCount,
      maxAttack: this.#maxAttack,
      penaltyCount: this.#penaltyCount,
    });
  }

  // ───────────────────────── 보조 ─────────────────────────

  readonly #env: oneCard.OneCardEnv = { shuffle: (cards) => this.#shuffle(cards) };

  /** Fisher-Yates. 난수는 서버 rng(crypto)만 쓴다 (CLAUDE.md 원칙 5) */
  #shuffle(cards: readonly Card[]): Card[] {
    return shuffle(cards, this.rng);
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
    this.io.sendTo(m.id, 'your_hand', {
      cards: [...(g.hands[m.seat] ?? [])],
      drawn: g.turn === m.seat ? g.drawn : null,
    });
  }
}
