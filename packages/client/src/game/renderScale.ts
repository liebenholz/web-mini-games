/**
 * 캔버스를 그릴 픽셀 배율. 폰은 보통 2~3배 밀도라서 1배로 그리면 늘려 보여 주면서 흐릿해진다.
 * 3배를 넘으면 눈으로 구분되지 않고 그리는 비용만 늘어서 3에서 자른다
 */
export function renderScale(dpr: number): number {
  return Math.min(3, Math.max(1, Number.isFinite(dpr) ? dpr : 1));
}
