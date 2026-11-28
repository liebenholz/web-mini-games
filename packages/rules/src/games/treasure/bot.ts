import { type Cell, cellOf, GRID_CELLS } from './game.js';

/**
 * BH-12, BH-13: 봇과 시간 초과 대신 고르기. 보물을 모르므로 81칸 중 고르게 무작위로 고른다.
 * roll은 서버 난수 (0 이상 1 미만)
 */
export function randomCell(roll: number): Cell {
  return cellOf(Math.min(GRID_CELLS - 1, Math.max(0, Math.floor(roll * GRID_CELLS))));
}
