/**
 * 원카드 카드 (docs/specs/one-card.md 2장). 순수 데이터와 판정만 둔다.
 * 표기: 모양(S H D C) + 숫자(A 2~10 J Q K). 조커는 JB(흑백), JC(컬러). 클로버 J(CJ)와 겹치지 않게 J로 시작한다 (C-02)
 */
export const SUITS = ['S', 'H', 'D', 'C'] as const;
export type Suit = (typeof SUITS)[number];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export type Rank = (typeof RANKS)[number];
export type Card = string;

export const BLACK_JOKER = 'JB';
export const COLOR_JOKER = 'JC';

/** C-01: 52장 + 조커 2장 = 54장. 섞지 않은 순서 (섞기는 서버가 한다) */
export function fullDeck(): Card[] {
  const cards: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) cards.push(`${s}${r}`);
  cards.push(BLACK_JOKER, COLOR_JOKER);
  return cards;
}

export function isJoker(card: Card): boolean {
  return card === BLACK_JOKER || card === COLOR_JOKER;
}

export function suitOf(card: Card): Suit | null {
  if (isJoker(card)) return null;
  const s = card[0];
  return SUITS.find((x) => x === s) ?? null;
}

export function rankOf(card: Card): Rank | null {
  if (isJoker(card)) return null;
  const r = card.slice(1);
  return RANKS.find((x) => x === r) ?? null;
}

export function isSuit(value: unknown): value is Suit {
  return SUITS.some((s) => s === value);
}

/** 클라이언트가 보낸 값이 54장 중 하나인가 */
export function isCard(value: unknown): value is Card {
  if (typeof value !== 'string') return false;
  if (isJoker(value)) return true;
  return suitOf(value) !== null && rankOf(value) !== null;
}

/** C-20: 공격 장수. 공격 카드가 아니면 0 */
export function attackValue(card: Card): number {
  if (card === COLOR_JOKER) return 7;
  if (card === BLACK_JOKER) return 5;
  const r = rankOf(card);
  if (r === 'A') return 3;
  if (r === '2') return 2;
  return 0;
}

/** C-04: 첫 카드로 쓸 수 있는 숫자 카드 (3~6, 8~10) */
export function isPlainNumber(card: Card): boolean {
  const r = rankOf(card);
  return r !== null && ['3', '4', '5', '6', '8', '9', '10'].includes(r);
}

/** 화면 표시용 이름 (예: ♠7, 흑백 조커) */
export function cardLabel(card: Card): string {
  if (card === BLACK_JOKER) return '흑백 조커';
  if (card === COLOR_JOKER) return '컬러 조커';
  const sym: Record<Suit, string> = { S: '♠', H: '♥', D: '◆', C: '♣' };
  const s = suitOf(card);
  return s ? `${sym[s]}${rankOf(card) ?? ''}` : card;
}
