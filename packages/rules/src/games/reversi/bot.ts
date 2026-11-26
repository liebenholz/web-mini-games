import { type Board, indexOf, type Point, type ReversiColor } from './board.js';
import { legalMoves } from './rules.js';

/**
 * 자리 가중치 (RV-13): 모서리 > 변 > 안쪽, 모서리 옆 칸(X, C 자리)은 피한다.
 * 행 순서는 판 배열과 같다 (y=0이 맨 위)
 */
// prettier-ignore
const WEIGHTS: readonly number[] = [
  100, -20, 10,  5,  5, 10, -20, 100,
  -20, -50, -2, -2, -2, -2, -50, -20,
   10,  -2,  1,  1,  1,  1,  -2,  10,
    5,  -2,  1,  0,  0,  1,  -2,   5,
    5,  -2,  1,  0,  0,  1,  -2,   5,
   10,  -2,  1,  1,  1,  1,  -2,  10,
  -20, -50, -2, -2, -2, -2, -50, -20,
  100, -20, 10,  5,  5, 10, -20, 100,
];

/**
 * 리버시 봇 (RV-13, RV-12의 대신 두기도 같은 판단). 자리 가중치 + 뒤집는 개수 × 2가 가장 큰 수.
 * 같은 점수가 여럿이면 roll(0 이상 1 미만, 서버 난수)로 고른다. 순수 함수 (원칙 3).
 * 둘 곳이 없으면 null
 */
export function reversiBotMove(board: Board, color: ReversiColor, roll = 0): Point | null {
  const moves = legalMoves(board, color);
  if (moves.length === 0) return null;
  let best = -Infinity;
  let top: Point[] = [];
  for (const m of moves) {
    const score = (WEIGHTS[indexOf(m)] ?? 0) + m.flips.length * 2;
    if (score > best) {
      best = score;
      top = [{ x: m.x, y: m.y }];
    } else if (score === best) top.push({ x: m.x, y: m.y });
  }
  const i = Math.min(top.length - 1, Math.max(0, Math.floor(roll * top.length)));
  return top[i] ?? null;
}
