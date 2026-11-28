/**
 * 무승부 제안 규칙 (docs/specs/gomoku.md G-14~G-16). 순수 함수만 둔다 (원칙 3).
 * 돌 개수는 판 전체의 돌 수(흑+백)다. "서로 30수"는 전체 60돌이다.
 */

/** G-15: 이 개수 이상 놓인 뒤에 제안할 수 있다 (서로 30수씩) */
export const DRAW_MIN_STONES = 60;
/** G-15: 거절당하면 전체 돌이 이만큼 더 놓여야(내 수 10번) 다시 제안할 수 있다 */
export const DRAW_RETRY_STONES = 20;
/** G-16: 응답 시간 */
export const DRAW_ANSWER_SECONDS = 15;

export type DrawOfferCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'EARLY' | 'COOLDOWN'; readonly stonesLeft: number };

/** 제안할 수 있는가. blockedUntil: 거절당한 뒤 이 돌 개수가 될 때까지 못 한다 (없으면 0) */
export function drawOfferCheck(stoneCount: number, blockedUntil: number): DrawOfferCheck {
  if (stoneCount < DRAW_MIN_STONES)
    return { ok: false, reason: 'EARLY', stonesLeft: DRAW_MIN_STONES - stoneCount };
  if (stoneCount < blockedUntil)
    return { ok: false, reason: 'COOLDOWN', stonesLeft: blockedUntil - stoneCount };
  return { ok: true };
}

/** 화면에 보여 줄 "내 수 N번" (남은 돌 수의 절반, 올림) */
export function myMovesLeft(stonesLeft: number): number {
  return Math.ceil(stonesLeft / 2);
}
