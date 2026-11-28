import { MAX_PUMPS_PER_TURN } from './game.js';

/**
 * BL-12, BL-13: 봇과 시간 초과 대신 누르기. 터지는 횟수를 모르므로 1~3번을 고르게 무작위로 고른다.
 * roll은 서버 난수 (0 이상 1 미만)
 */
export function balloonPumps(roll: number): number {
  const i = Math.floor(roll * MAX_PUMPS_PER_TURN);
  return Math.min(MAX_PUMPS_PER_TURN, Math.max(1, i + 1));
}
