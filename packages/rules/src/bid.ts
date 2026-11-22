import type {
  Bid,
  BidCheck,
  BidFace,
  DieFace,
  LiarCheck,
  PlayerDice,
  RoundResult,
  RuleOptions,
} from './types.js';
import { DEFAULT_RULE_OPTIONS } from './types.js';

export function isBidFace(value: unknown): value is BidFace {
  return value === 2 || value === 3 || value === 4 || value === 5 || value === 6;
}

/** R-07: 개수가 더 많거나, 개수가 같고 눈이 더 크면 상향이다. */
export function isHigherBid(prev: Bid, next: Bid): boolean {
  if (next.quantity > prev.quantity) return true;
  return next.quantity === prev.quantity && next.face > prev.face;
}

/**
 * R-05, R-07, R-11: 새 선언이 합법인지 검사한다.
 * - 눈은 2~6 (E-03), 개수는 1 이상 테이블 총 주사위 수 이하 (E-02)
 * - 직전 선언이 있으면 그보다 높아야 한다 (E-01)
 * - 직전이 (총 주사위 수, 6)이면 어떤 선언도 상향이 될 수 없다 (R-11)
 *
 * `next`는 신뢰할 수 없는 입력에서 올 수 있으므로 런타임 타입도 검사한다.
 */
export function isValidBid(
  prev: Bid | null,
  next: { readonly quantity: unknown; readonly face: unknown },
  totalDice: number,
  _options: RuleOptions = DEFAULT_RULE_OPTIONS,
): BidCheck {
  const { quantity, face } = next;
  if (
    typeof quantity !== 'number' ||
    !Number.isInteger(quantity) ||
    typeof face !== 'number' ||
    !Number.isInteger(face)
  ) {
    return { ok: false, code: 'INVALID_BID', reason: 'NOT_INTEGER' };
  }
  if (!isBidFace(face)) return { ok: false, code: 'INVALID_BID', reason: 'FACE_OUT_OF_RANGE' };
  if (quantity < 1 || quantity > totalDice)
    return { ok: false, code: 'INVALID_BID', reason: 'QUANTITY_OUT_OF_RANGE' };
  if (prev !== null && !isHigherBid(prev, { quantity, face })) {
    return { ok: false, code: 'INVALID_BID', reason: 'NOT_HIGHER' };
  }
  return { ok: true };
}

/** R-06, R-08: 직전 선언이 있어야 라이어를 외칠 수 있다. 차례 검사는 서버가 한다. */
export function canCallLiar(prev: Bid | null): LiarCheck {
  return prev === null ? { ok: false, code: 'NO_BID_TO_CALL' } : { ok: true };
}

/**
 * S-06: 가장 낮은 합법 선언.
 * - 직전 선언이 없으면 (1, 2)
 * - 같은 개수에서 눈 +1, 눈이 6이면 개수 +1과 눈 2
 * - 상향할 수 없으면 null (R-11) → 호출 측은 라이어를 선택한다
 */
export function minimumRaise(prev: Bid | null, totalDice: number): Bid | null {
  if (totalDice < 1) return null;
  if (prev === null) return { quantity: 1, face: 2 };
  if (prev.face < 6) return { quantity: prev.quantity, face: (prev.face + 1) as BidFace };
  if (prev.quantity < totalDice) return { quantity: prev.quantity + 1, face: 2 };
  return null;
}

/** 주어진 눈으로 선언할 때 가장 낮은 합법 개수. 불가능하면 null. */
export function minimumQuantityForFace(prev: Bid | null, face: BidFace, totalDice: number): number | null {
  const quantity = prev === null ? 1 : face > prev.face ? prev.quantity : prev.quantity + 1;
  return quantity <= totalDice ? quantity : null;
}

/** R-09: 선언 눈의 개수를 센다. 와일드가 켜져 있으면 1도 함께 센다. */
export function countFace(
  allDice: readonly PlayerDice[] | readonly (readonly DieFace[])[],
  face: BidFace,
  options: RuleOptions = DEFAULT_RULE_OPTIONS,
): number {
  let count = 0;
  for (const entry of allDice) {
    const dice = 'dice' in entry ? entry.dice : entry;
    for (const die of dice) {
      if (die === face || (options.onesWild && die === 1)) count += 1;
    }
  }
  return count;
}

/** R-10: 라이어 판정. 실제 ≥ 선언이면 라이어를 외친 사람이, 아니면 선언자가 1개를 잃는다. */
export function resolveLiar(
  bid: Bid,
  allDice: readonly PlayerDice[],
  bidderSeat: number,
  callerSeat: number,
  options: RuleOptions = DEFAULT_RULE_OPTIONS,
): RoundResult {
  const actual = countFace(allDice, bid.face, options);
  const bidSucceeded = actual >= bid.quantity;
  return {
    bid,
    actual,
    bidSucceeded,
    bidderSeat,
    callerSeat,
    loserSeat: bidSucceeded ? callerSeat : bidderSeat,
  };
}
