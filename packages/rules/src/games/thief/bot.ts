/**
 * TF-13: 봇은 자기 패와 공개 정보만 쓴다. 뽑을 위치는 섞여 있어 알 수 있는 것이 없으니 무작위다.
 * roll01은 서버가 만든 [0, 1) 난수 (원칙 3, 5)
 */
export function thiefBotIndex(targetCount: number, roll01: number): number {
  if (targetCount <= 0) return 0;
  return Math.min(targetCount - 1, Math.floor(roll01 * targetCount));
}
