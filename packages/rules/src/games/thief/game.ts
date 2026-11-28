/**
 * 도둑잡기 룰 (docs/specs/thief.md TF-01~TF-14). 순수 함수만 둔다.
 * 섞기는 서버가 하고(원칙 5), 여기서는 섞는 함수를 인자로 받는다 (원칙 3).
 * 카드 표기: 모양(S H D C) + 숫자(A 2~10 J Q K). 조커는 JK
 */
export const SUITS = ['S', 'H', 'D', 'C'] as const;
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
export type Card = string;
export const JOKER = 'JK';

/** TF-01: 52장 + 조커 1장. 섞지 않은 순서 */
export function fullDeck(): Card[] {
  const cards: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) cards.push(`${s}${r}`);
  cards.push(JOKER);
  return cards;
}

export const DECK_SIZE = 53;

export const isJoker = (card: Card): boolean => card === JOKER;

export function rankOf(card: Card): Rank | null {
  if (isJoker(card)) return null;
  const r = card.slice(1);
  return RANKS.find((x) => x === r) ?? null;
}

export function suitOf(card: Card): Suit | null {
  if (isJoker(card)) return null;
  return SUITS.find((s) => s === card[0]) ?? null;
}

export type Shuffle = (cards: readonly Card[]) => Card[];

/** TF-03: 패에서 짝을 모두 낸다. 같은 숫자 3장이면 1장, 4장이면 0장이 남는다. 조커는 짝이 없다 */
export function removePairs(hand: readonly Card[]): { hand: Card[]; pairs: Rank[] } {
  const byRank = new Map<Rank, Card[]>();
  const rest: Card[] = [];
  for (const c of hand) {
    const r = rankOf(c);
    if (r === null) {
      rest.push(c);
      continue;
    }
    const list = byRank.get(r) ?? [];
    list.push(c);
    byRank.set(r, list);
  }
  const pairs: Rank[] = [];
  const kept: Card[] = [];
  for (const [r, list] of byRank) {
    for (let i = 0; i + 1 < list.length; i += 2) pairs.push(r);
    if (list.length % 2 === 1) kept.push(list[list.length - 1] as Card);
  }
  // 원래 패 순서를 최대한 지킨다
  const keep = new Set(kept);
  return { hand: hand.filter((c) => isJoker(c) || keep.has(c)), pairs };
}

export interface ThiefState {
  readonly players: number;
  readonly hands: readonly (readonly Card[])[];
  /** 패를 다 낸 사람 (안전) */
  readonly out: readonly boolean[];
  /** 빠진 순서대로 좌석 (같은 순간에 빠지면 뽑은 사람이 먼저) */
  readonly outOrder: readonly number[];
  /** 내려놓은 짝의 숫자 (공개 정보) */
  readonly pairs: readonly Rank[];
  /** 지금 뽑을 차례인 좌석 */
  readonly turn: number;
  readonly draws: number;
}

const nextActive = (out: readonly boolean[], from: number): number => {
  const n = out.length;
  for (let i = 1; i <= n; i += 1) {
    const s = (from + i) % n;
    if (!out[s]) return s;
  }
  return -1;
};

export const activeCount = (s: ThiefState): number => s.out.filter((o) => !o).length;

/** TF-10 */
export const isFinished = (s: ThiefState): boolean => activeCount(s) <= 1;

/** 끝난 뒤 조커를 든 사람(당첨). 아직 안 끝났으면 null */
export function loserSeat(s: ThiefState): number | null {
  if (!isFinished(s)) return null;
  const seat = s.out.findIndex((o) => !o);
  return seat >= 0 ? seat : null;
}

/** TF-02, TF-03: 나누고 첫 짝을 낸다. deck은 서버가 섞은 53장 */
export function createThief(deck: readonly Card[], players: number, firstSeat: number): ThiefState {
  if (players < 2 || firstSeat < 0 || firstSeat >= players || deck.length !== DECK_SIZE)
    throw new Error('bad setup');
  const dealt: Card[][] = Array.from({ length: players }, () => []);
  deck.forEach((c, i) => dealt[(firstSeat + i) % players]?.push(c));
  const pairs: Rank[] = [];
  const hands = dealt.map((h) => {
    const r = removePairs(h);
    pairs.push(...r.pairs);
    return r.hand;
  });
  const out = hands.map((h) => h.length === 0);
  const outOrder = out.flatMap((o, seat) => (o ? [seat] : []));
  const turn = out[firstSeat] ? nextActive(out, firstSeat) : firstSeat;
  return { players, hands, out, outOrder, pairs, turn, draws: 0 };
}

/** 뽑을 대상: 차례인 사람의 다음 사람 중 패가 남은 사람 (TF-05) */
export function targetOf(s: ThiefState, seat: number): number {
  return nextActive(s.out, seat);
}

export type ThiefError = 'NOT_YOUR_TURN' | 'INVALID_MOVE' | 'GAME_OVER';

export interface DrawOk {
  readonly ok: true;
  readonly state: ThiefState;
  readonly target: number;
  /** 뽑은 카드 (뽑은 사람에게만 알린다) */
  readonly card: Card;
  /** 짝이 맞아 내려놓은 숫자 */
  readonly matched: Rank | null;
  readonly drawerOut: boolean;
  readonly targetOut: boolean;
}
export type DrawOutcome = DrawOk | { readonly ok: false; readonly code: ThiefError };

/** TF-05~TF-09: 다음 사람의 index번째 카드를 뽑는다. 양쪽 패는 섞는다 (TF-06) */
export function draw(state: ThiefState, seat: number, index: unknown, shuffle: Shuffle): DrawOutcome {
  if (isFinished(state)) return { ok: false, code: 'GAME_OVER' };
  if (seat !== state.turn) return { ok: false, code: 'NOT_YOUR_TURN' };
  const target = targetOf(state, seat);
  const targetHand = state.hands[target] ?? [];
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= targetHand.length)
    return { ok: false, code: 'INVALID_MOVE' };
  const card = targetHand[index] as Card;
  const targetRest = targetHand.filter((_, i) => i !== index);
  const mine = state.hands[seat] ?? [];
  const rank = rankOf(card);
  const pairAt = rank === null ? -1 : mine.findIndex((c) => rankOf(c) === rank);
  const matched = pairAt >= 0 ? rank : null;
  const mineNext = pairAt >= 0 ? mine.filter((_, i) => i !== pairAt) : [...mine, card];
  const hands = state.hands.map((h, i) =>
    i === seat ? shuffle(mineNext) : i === target ? shuffle(targetRest) : h,
  );
  const drawerOut = mineNext.length === 0;
  const targetOut = targetRest.length === 0;
  const out = state.out.map((o, i) => o || (i === seat && drawerOut) || (i === target && targetOut));
  const outOrder = [...state.outOrder, ...(drawerOut ? [seat] : []), ...(targetOut ? [target] : [])];
  const next: ThiefState = {
    ...state,
    hands,
    out,
    outOrder,
    pairs: matched ? [...state.pairs, matched] : state.pairs,
    turn: isFinished({ ...state, out }) ? seat : nextActive(out, seat),
    draws: state.draws + 1,
  };
  return { ok: true, state: next, target, card, matched, drawerOut, targetOut };
}

/** TF-11: 순위. 당첨 = 2위, 나머지 = 1위 (파티 게임 공통) */
export function finalRanks(s: ThiefState): number[] {
  const loser = loserSeat(s);
  return s.out.map((_, seat) => (seat === loser ? 2 : 1));
}
