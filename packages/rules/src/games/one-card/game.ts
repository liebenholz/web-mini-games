/**
 * 원카드 진행 규칙 (docs/specs/one-card.md 2~5장). 순수 함수: 상태를 받아 새 상태와 이벤트를 돌려준다.
 * 난수가 필요한 섞기(C-15)는 env.shuffle로 받는다. 시간(원카드 창, 턴 타이머)은 서버가 맡는다.
 */
import {
  attackValue,
  BLACK_JOKER,
  COLOR_JOKER,
  isJoker,
  isPlainNumber,
  isSuit,
  rankOf,
  suitOf,
  type Card,
  type Suit,
} from './cards.js';

/** C-03 */
export const HAND_SIZE = 7;
/** C-34: 이 장수를 넘으면 파산 */
export const BANKRUPT_LIMIT = 20;

export type SeatStatus = 'playing' | 'finished' | 'bankrupt';

export interface OneCardState {
  /** 좌석별 패. 서버만 가진다 (C-40) */
  readonly hands: readonly (readonly Card[])[];
  /** 덱. 0번이 맨 위 (C-41) */
  readonly deck: readonly Card[];
  /** 버린 카드 더미. 마지막이 맨 위(펼친 카드) */
  readonly discard: readonly Card[];
  /** C-12: 맨 위가 7일 때 고른 모양 */
  readonly chosenSuit: Suit | null;
  /** C-20, C-21: 누적된 공격 장수. 0이면 공격 중이 아님 */
  readonly attack: number;
  /** 1 = 좌석 번호 오름차순(시계 방향), -1 = 반대 (C-25) */
  readonly direction: 1 | -1;
  /** 지금 차례인 좌석 */
  readonly turn: number;
  /** C-14: 이번 차례에 가져온 카드. 이 카드만 바로 낼 수 있다 */
  readonly drawn: Card | null;
  readonly status: readonly SeatStatus[];
  /** 다 낸 순서 (C-35) */
  readonly finishOrder: readonly number[];
  /** 파산한 순서 (C-35) */
  readonly bankruptOrder: readonly number[];
  readonly over: boolean;
}

export interface OneCardEnv {
  /** 서버가 crypto 난수로 섞는다. 테스트는 고정 순서를 넣는다 */
  readonly shuffle: (cards: readonly Card[]) => Card[];
}

export type DrawReason = 'draw' | 'attack' | 'penalty';

export type OneCardEvent =
  | { readonly type: 'played'; readonly seat: number; readonly card: Card; readonly suit: Suit | null }
  | {
      readonly type: 'drew';
      readonly seat: number;
      readonly cards: readonly Card[];
      readonly reason: DrawReason;
    }
  | { readonly type: 'reshuffled'; readonly count: number }
  /** C-30: 이 좌석의 패가 1장이 됐다. 서버가 원카드 창을 연다 */
  | { readonly type: 'one_card'; readonly seat: number }
  | { readonly type: 'finished'; readonly seat: number; readonly rank: number }
  | { readonly type: 'bankrupt'; readonly seat: number }
  /** 좌석을 순위 순서로 (C-35) */
  | { readonly type: 'game_over'; readonly ranking: readonly number[] };

export type OneCardErrorCode = 'NOT_YOUR_TURN' | 'INVALID_CARD' | 'INVALID_SUIT' | 'INVALID_STATE';

export type OneCardResult =
  | { readonly ok: true; readonly state: OneCardState; readonly events: readonly OneCardEvent[] }
  | { readonly ok: false; readonly code: OneCardErrorCode };

type Mutable = {
  hands: Card[][];
  deck: Card[];
  discard: Card[];
  chosenSuit: Suit | null;
  attack: number;
  direction: 1 | -1;
  turn: number;
  drawn: Card | null;
  status: SeatStatus[];
  finishOrder: number[];
  bankruptOrder: number[];
  over: boolean;
};

function copy(s: OneCardState): Mutable {
  return {
    hands: s.hands.map((h) => [...h]),
    deck: [...s.deck],
    discard: [...s.discard],
    chosenSuit: s.chosenSuit,
    attack: s.attack,
    direction: s.direction,
    turn: s.turn,
    drawn: s.drawn,
    status: [...s.status],
    finishOrder: [...s.finishOrder],
    bankruptOrder: [...s.bankruptOrder],
    over: s.over,
  };
}

const fail = (code: OneCardErrorCode): OneCardResult => ({ ok: false, code });

/**
 * C-03, C-04, C-05: 섞인 덱으로 시작한다. 한 사람당 7장을 나눠 주고,
 * 숫자 카드(3~6, 8~10)가 나올 때까지 특수 카드는 덱 맨 아래로 넣고 다시 편다
 */
export function startOneCard(
  shuffledDeck: readonly Card[],
  seatCount: number,
  firstSeat: number,
  handSize = HAND_SIZE,
): OneCardState {
  if (seatCount < 2 || seatCount * handSize >= shuffledDeck.length) throw new Error('bad seat count');
  const deck = [...shuffledDeck];
  const hands: Card[][] = Array.from({ length: seatCount }, () => []);
  for (let i = 0; i < handSize; i += 1) for (const hand of hands) hand.push(deck.shift() as Card);
  let first: Card | undefined;
  for (let i = 0; i < deck.length && first === undefined; i += 1) {
    const c = deck.shift() as Card;
    if (isPlainNumber(c)) first = c;
    else deck.push(c);
  }
  if (first === undefined) throw new Error('no number card');
  return {
    hands,
    deck,
    discard: [first],
    chosenSuit: null,
    attack: 0,
    direction: 1,
    turn: firstSeat,
    drawn: null,
    status: hands.map(() => 'playing'),
    finishOrder: [],
    bankruptOrder: [],
    over: false,
  };
}

export function topCard(s: Pick<OneCardState, 'discard'>): Card {
  return s.discard[s.discard.length - 1] as Card;
}

export function activeSeats(s: Pick<OneCardState, 'status'>): number[] {
  return s.status.flatMap((v, i) => (v === 'playing' ? [i] : []));
}

/** 이 방향으로 from 다음에 오는, 아직 패가 있는 좌석 */
export function nextActive(s: Pick<OneCardState, 'status' | 'direction'>, from: number): number {
  const n = s.status.length;
  for (let i = 1; i <= n; i += 1) {
    const seat = (((from + s.direction * i) % n) + n) % n;
    if (s.status[seat] === 'playing') return seat;
  }
  return from;
}

/** 공개 정보만으로 판정할 수 있게 상태 일부만 받는다 (봇과 클라이언트도 쓴다) */
export type PlayView = Pick<OneCardState, 'discard' | 'chosenSuit' | 'attack' | 'drawn'>;

/**
 * C-10, C-11, C-12, C-21: 이 카드를 지금 낼 수 있는가 (내 차례이고 내 패에 있다고 가정)
 */
export function canPlayCard(s: PlayView, card: Card): boolean {
  if (s.drawn !== null && card !== s.drawn) return false;
  const top = topCard(s);
  if (s.attack > 0) {
    if (attackValue(card) === 0) return false;
    if (top === COLOR_JOKER) return false;
    if (top === BLACK_JOKER) return card === COLOR_JOKER;
    if (isJoker(card)) return true;
    return suitOf(card) === suitOf(top) || rankOf(card) === rankOf(top);
  }
  if (isJoker(card)) return true;
  if (isJoker(top)) return true;
  if (s.chosenSuit !== null) return suitOf(card) === s.chosenSuit || rankOf(card) === '7';
  return suitOf(card) === suitOf(top) || rankOf(card) === rankOf(top);
}

export function playableCards(s: OneCardState, seat: number): Card[] {
  return (s.hands[seat] ?? []).filter((c) => canPlayCard(s, c));
}

/** C-15: 덱에서 n장. 모자라면 맨 위 1장만 남기고 버린 카드를 섞어 덱에 붙인다 */
function take(m: Mutable, seat: number, n: number, reason: DrawReason, env: OneCardEnv, ev: OneCardEvent[]) {
  if (m.deck.length < n && m.discard.length > 1) {
    const top = m.discard.pop() as Card;
    const rest = m.discard;
    m.deck = m.deck.concat(env.shuffle(rest));
    m.discard = [top];
    ev.push({ type: 'reshuffled', count: rest.length });
  }
  const cards = m.deck.splice(0, Math.min(n, m.deck.length));
  (m.hands[seat] as Card[]).push(...cards);
  ev.push({ type: 'drew', seat, cards, reason });
  return cards;
}

/** C-34: 20장을 넘으면 파산. 패는 버린 더미 맨 아래로. 공격은 사라진다. true면 파산했다 */
function checkBankrupt(m: Mutable, seat: number, ev: OneCardEvent[]): boolean {
  const hand = m.hands[seat] as Card[];
  if (hand.length <= BANKRUPT_LIMIT) return false;
  m.status[seat] = 'bankrupt';
  m.bankruptOrder.push(seat);
  m.discard = [...hand, ...m.discard];
  m.hands[seat] = [];
  m.attack = 0;
  m.drawn = null;
  ev.push({ type: 'bankrupt', seat });
  if (m.turn === seat) m.turn = nextActive(m, seat);
  checkOver(m, ev);
  return true;
}

/** C-35, C-36: 패를 가진 사람이 1명 이하면 끝. 남은 1명이 다 낸 사람들 다음 순위 */
function checkOver(m: Mutable, ev: OneCardEvent[]): void {
  if (m.over) return;
  const active = activeSeats(m);
  if (active.length > 1) return;
  for (const seat of active) {
    m.status[seat] = 'finished';
    m.finishOrder.push(seat);
    ev.push({ type: 'finished', seat, rank: m.finishOrder.length });
  }
  m.over = true;
  m.drawn = null;
  ev.push({ type: 'game_over', ranking: rankingOf(m) });
}

/** C-35: 다 낸 순서 → 파산한 사람은 늦게 파산한 쪽이 위 */
export function rankingOf(s: Pick<OneCardState, 'finishOrder' | 'bankruptOrder'>): number[] {
  return [...s.finishOrder, ...[...s.bankruptOrder].reverse()];
}

function guard(s: OneCardState, seat: number): OneCardErrorCode | null {
  if (s.over || s.status[seat] !== 'playing') return 'INVALID_STATE';
  if (s.turn !== seat) return 'NOT_YOUR_TURN';
  return null;
}

/**
 * 카드 한 장을 낸다 (C-10~C-13, C-20~C-26, C-33). 7이면 suit가 있어야 하고, 7이 아니면 없어야 한다
 */
export function playCard(s: OneCardState, seat: number, card: Card, suit: unknown): OneCardResult {
  const g = guard(s, seat);
  if (g) return fail(g);
  const hand = s.hands[seat] ?? [];
  const at = hand.indexOf(card);
  if (at < 0 || !canPlayCard(s, card)) return fail('INVALID_CARD');
  const isSeven = rankOf(card) === '7';
  if (isSeven ? !isSuit(suit) : suit !== undefined && suit !== null) return fail('INVALID_SUIT');

  const m = copy(s);
  const ev: OneCardEvent[] = [];
  (m.hands[seat] as Card[]).splice(at, 1);
  m.discard.push(card);
  m.chosenSuit = isSeven ? (suit as Suit) : null;
  m.drawn = null;
  m.attack += attackValue(card);
  ev.push({ type: 'played', seat, card, suit: m.chosenSuit });

  const left = (m.hands[seat] as Card[]).length;
  const done = left === 0;
  if (done) {
    m.status[seat] = 'finished';
    m.finishOrder.push(seat);
    ev.push({ type: 'finished', seat, rank: m.finishOrder.length });
  } else if (left === 1) {
    ev.push({ type: 'one_card', seat });
  }

  const rank = rankOf(card);
  // 2명일 때 Q는 J와 같다 (C-25). 다 낸 사람을 빼고 센다
  const activeBefore = activeSeats(m).length + (done ? 1 : 0);
  if (rank === 'K' && !done) {
    // C-23: 같은 사람이 한 번 더
  } else if (rank === 'J' || (rank === 'Q' && activeBefore === 2)) {
    m.turn = nextActive(m, nextActive(m, seat));
  } else {
    if (rank === 'Q') m.direction = m.direction === 1 ? -1 : 1;
    m.turn = nextActive(m, seat);
  }
  checkOver(m, ev);
  return { ok: true, state: m, events: ev };
}

/**
 * 가져오기 (C-14, C-22). 공격 중이면 누적 장수를 받고 차례가 끝난다.
 * 아니면 1장 가져오고, 낼 수 있으면 같은 차례에 그 카드만 낼 수 있다 (낼 수 없으면 차례가 끝난다)
 */
export function drawCards(s: OneCardState, seat: number, env: OneCardEnv): OneCardResult {
  const g = guard(s, seat);
  if (g) return fail(g);
  if (s.drawn !== null) return fail('INVALID_STATE');
  const m = copy(s);
  const ev: OneCardEvent[] = [];
  if (m.attack > 0) {
    take(m, seat, m.attack, 'attack', env, ev);
    m.attack = 0;
    if (!checkBankrupt(m, seat, ev)) m.turn = nextActive(m, seat);
    return { ok: true, state: m, events: ev };
  }
  const [card] = take(m, seat, 1, 'draw', env, ev);
  if (checkBankrupt(m, seat, ev)) return { ok: true, state: m, events: ev };
  if (card !== undefined && canPlayCard({ ...m, drawn: card }, card)) m.drawn = card;
  else m.turn = nextActive(m, seat);
  return { ok: true, state: m, events: ev };
}

/** C-14: 가져온 카드를 내지 않고 넘긴다 */
export function passTurn(s: OneCardState, seat: number): OneCardResult {
  const g = guard(s, seat);
  if (g) return fail(g);
  if (s.drawn === null) return fail('INVALID_STATE');
  const m = copy(s);
  m.drawn = null;
  m.turn = nextActive(m, seat);
  return { ok: true, state: m, events: [] };
}

/** C-31: 원카드 벌칙 1장. 차례와 상관없이 적용한다 */
export function penaltyDraw(s: OneCardState, seat: number, env: OneCardEnv): OneCardResult {
  if (s.over || s.status[seat] !== 'playing') return fail('INVALID_STATE');
  const m = copy(s);
  const ev: OneCardEvent[] = [];
  take(m, seat, 1, 'penalty', env, ev);
  checkBankrupt(m, seat, ev);
  return { ok: true, state: m, events: ev };
}

/**
 * C-51: 시간 초과 자동 행동. 공격 중이면 받아 먹고, 아니면 1장 가져오고 넘긴다 (가져온 카드는 내지 않는다).
 * 이미 가져온 뒤면 그냥 넘긴다
 */
export function autoAction(s: OneCardState, seat: number, env: OneCardEnv): OneCardResult {
  if (s.drawn !== null) return passTurn(s, seat);
  const drawn = drawCards(s, seat, env);
  if (!drawn.ok || drawn.state.drawn === null) return drawn;
  const passed = passTurn(drawn.state, seat);
  if (!passed.ok) return passed;
  return { ok: true, state: passed.state, events: [...drawn.events, ...passed.events] };
}
