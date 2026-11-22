import { minimumQuantityForFace, minimumRaise } from './bid.js';
import type { Bid, BidFace, DieFace } from './types.js';
import { BID_FACES } from './types.js';

export interface BotPublicState {
  /** 직전 선언. 라운드 첫 턴이면 null */
  readonly currentBid: Bid | null;
  /** 테이블 위 주사위 총 개수 */
  readonly totalDice: number;
}

export interface BotParams {
  /** 직전 선언 개수가 기대 개수 + margin을 넘으면 라이어 (S-11 여유치) */
  readonly margin: number;
}

export const DEFAULT_BOT_PARAMS: BotParams = Object.freeze({ margin: 1 });

export type BotDecision = { readonly type: 'bid'; readonly bid: Bid } | { readonly type: 'liar' };

/** 모르는 주사위 하나가 특정 눈(2~6)으로 셀 확률 (그 눈 또는 1) */
const UNKNOWN_DIE_HIT_RATE = 1 / 3;

/** S-11: 기대 개수 = 내 해당 개수(1 포함) + 남의 주사위 수 ÷ 3 */
export function expectedCount(myDice: readonly DieFace[], face: BidFace, totalDice: number): number {
  const mine = myDice.filter((d) => d === face || d === 1).length;
  const others = Math.max(0, totalDice - myDice.length);
  return mine + others * UNKNOWN_DIE_HIT_RATE;
}

/** 내가 가장 많이 가진 눈(2~6, 1 제외). 같으면 더 큰 눈. */
export function bestFace(myDice: readonly DieFace[]): BidFace {
  let best: BidFace = 6;
  let bestCount = -1;
  for (const face of BID_FACES) {
    const count = myDice.filter((d) => d === face).length;
    if (count >= bestCount) {
      best = face;
      bestCount = count;
    }
  }
  return best;
}

/**
 * S-11, S-12: 봇의 다음 행동. 자기 주사위와 공개 정보만 받는다.
 * - 직전 선언 개수 > 기대 개수 + 여유치 → 라이어
 * - 아니면 내가 가장 많이 가진 눈으로 최소 상향
 * - 그 눈으로 상향할 수 없으면 가장 낮은 합법 상향, 그것도 없으면 라이어 (R-11)
 * 라운드 첫 턴에는 라이어를 고르지 않는다 (R-06).
 */
export function botDecide(
  myDice: readonly DieFace[],
  publicState: BotPublicState,
  params: BotParams = DEFAULT_BOT_PARAMS,
): BotDecision {
  const { currentBid, totalDice } = publicState;
  if (
    currentBid !== null &&
    currentBid.quantity > expectedCount(myDice, currentBid.face, totalDice) + params.margin
  ) {
    return { type: 'liar' };
  }
  const face = bestFace(myDice);
  const quantity = minimumQuantityForFace(currentBid, face, totalDice);
  if (quantity !== null) return { type: 'bid', bid: { quantity, face } };
  const fallback = minimumRaise(currentBid, totalDice);
  if (fallback !== null) return { type: 'bid', bid: fallback };
  return { type: 'liar' };
}
