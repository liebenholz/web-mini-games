/**
 * UD-12, UD-13: 봇과 시간 초과 대신 말하기. 폭탄을 모르므로 범위 안에서 고르게 무작위로 고른다
 * (어느 수든 그 차례에 당첨될 확률은 1 ÷ 남은 숫자 수로 같다). roll은 서버 난수 (0 이상 1 미만)
 */
export function updownPick(range: { readonly low: number; readonly high: number }, roll: number): number {
  const span = range.high - range.low + 1;
  const i = Math.min(span - 1, Math.max(0, Math.floor(roll * span)));
  return range.low + i;
}
