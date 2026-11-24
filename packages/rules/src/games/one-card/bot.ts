import { attackValue, isJoker, rankOf, SUITS, suitOf, type Card, type Suit } from './cards.js';
import { canPlayCard, type PlayView } from './game.js';

export type OneCardBotAction =
  | { readonly type: 'play'; readonly card: Card; readonly suit: Suit | null }
  | { readonly type: 'draw' }
  | { readonly type: 'pass' };

/** 낼 순서: 숫자 카드 → J/Q/K → 공격(2, A) → 7 → 조커. 공격 카드와 조커는 아낀다 (C-56) */
function priority(card: Card): number {
  if (isJoker(card)) return 4;
  const r = rankOf(card);
  if (r === '7') return 3;
  if (attackValue(card) > 0) return 2;
  if (r === 'J' || r === 'Q' || r === 'K') return 1;
  return 0;
}

/** 7을 낼 때 고를 모양: 남은 패에 가장 많은 모양 */
function bestSuit(hand: readonly Card[], played: Card): Suit {
  const counts = new Map<Suit, number>();
  for (const c of hand) {
    if (c === played) continue;
    const s = suitOf(c);
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  let best: Suit = suitOf(played) ?? 'S';
  let most = 0;
  for (const s of SUITS) {
    const n = counts.get(s) ?? 0;
    if (n > most) {
      most = n;
      best = s;
    }
  }
  return best;
}

/**
 * C-56: 봇 판단. 자기 패(hand)와 공개 정보(view)만 쓴다.
 * 공격 중이면 받아칠 수 있을 때 가장 약한 공격 카드로 받아치고, 아니면 받아 먹는다
 */
export function oneCardBotAction(view: PlayView, hand: readonly Card[]): OneCardBotAction {
  const playable = hand.filter((c) => canPlayCard(view, c));
  if (view.drawn !== null) {
    if (!playable.includes(view.drawn)) return { type: 'pass' };
  }
  if (playable.length === 0) return view.drawn !== null ? { type: 'pass' } : { type: 'draw' };
  const sorted =
    view.attack > 0
      ? [...playable].sort((a, b) => attackValue(a) - attackValue(b))
      : [...playable].sort((a, b) => priority(a) - priority(b));
  const card = sorted[0] as Card;
  return { type: 'play', card, suit: rankOf(card) === '7' ? bestSuit(hand, card) : null };
}
