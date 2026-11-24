import { oneCard } from '@wmg/rules';
import { h } from '../../dom.js';

const SYMBOL: Record<oneCard.Suit, string> = { S: '♠', H: '♥', D: '◆', C: '♣' };
const SUIT_NAME: Record<oneCard.Suit, string> = { S: '스페이드', H: '하트', D: '다이아', C: '클로버' };

export function suitSymbol(s: oneCard.Suit): string {
  return SYMBOL[s];
}

export function suitName(s: oneCard.Suit): string {
  return SUIT_NAME[s];
}

export function isRed(card: string): boolean {
  const s = oneCard.suitOf(card);
  return s === 'H' || s === 'D';
}

/** 화면 읽기용 이름: "하트 9", "흑백 조커" */
export function cardName(card: string): string {
  if (oneCard.isJoker(card)) return oneCard.cardLabel(card);
  const s = oneCard.suitOf(card);
  return s ? `${SUIT_NAME[s]} ${oneCard.rankOf(card) ?? ''}` : card;
}

/** 카드 한 장 (앞면). 조커는 별 */
export function cardFace(card: string, extra = ''): HTMLElement {
  if (oneCard.isJoker(card)) {
    const color = card === oneCard.COLOR_JOKER;
    return h(
      'span',
      { class: `oc-card joker ${color ? 'color' : 'mono'} ${extra}`, 'data-card': card },
      h('span', { class: 'oc-corner' }, color ? '컬러' : '흑백'),
      h('span', { class: 'oc-pip', 'aria-hidden': 'true' }, '★'),
    );
  }
  const s = oneCard.suitOf(card) as oneCard.Suit;
  return h(
    'span',
    { class: `oc-card ${isRed(card) ? 'red' : 'black'} ${extra}`, 'data-card': card },
    h('span', { class: 'oc-corner' }, `${oneCard.rankOf(card) ?? ''}${SYMBOL[s]}`),
    h('span', { class: 'oc-pip', 'aria-hidden': 'true' }, SYMBOL[s]),
  );
}

/** 지금 맨 위 카드에 낼 수 있는 조건 (시안 1: "♥ 또는 9") */
export function playHint(topCard: string, chosenSuit: string, attack: number): string {
  if (!topCard) return '';
  if (attack > 0) {
    if (topCard === oneCard.COLOR_JOKER) return '받아칠 수 없어요';
    if (topCard === oneCard.BLACK_JOKER) return '컬러 조커로만 받아쳐요';
    const s = oneCard.suitOf(topCard) as oneCard.Suit;
    return `${SYMBOL[s]} 또는 ${oneCard.rankOf(topCard)}의 2·A, 조커`;
  }
  if (oneCard.isJoker(topCard)) return '아무 카드나';
  if (chosenSuit) return `${SYMBOL[chosenSuit as oneCard.Suit]} 또는 7`;
  const s = oneCard.suitOf(topCard) as oneCard.Suit;
  return `${SYMBOL[s]} 또는 ${oneCard.rankOf(topCard)}`;
}
