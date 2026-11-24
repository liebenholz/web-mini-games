import {
  type Board,
  type Cell,
  DIRECTIONS,
  EMPTY,
  GOMOKU_SIZE,
  type GomokuColor,
  inBounds,
  indexOf,
  otherColor,
  type Point,
  type Stone,
  stoneOf,
} from './board.js';
import { forbiddenReason, type GomokuRuleOptions, hasNeighbor, winningLine } from './rules.js';

/**
 * 오목 봇 (명세 G-24). 강할 필요는 없고, 사람이 보기에 "생각하고 두는" 수준이면 된다.
 * 1) 이기는 수 2) 상대가 이기는 수 막기 3) 모양 점수(내 공격 + 상대 수비)가 가장 높은 수.
 * 금수는 두지 않는다. 순수 함수이고 같은 판이면 항상 같은 수를 둔다 (난수 없음).
 */
export function gomokuBotMove(board: Board, color: GomokuColor, rules: GomokuRuleOptions): Point | null {
  const candidates = candidatePoints(board).filter((p) => forbiddenReason(board, p, color, rules) === null);
  if (candidates.length === 0) return null;
  const me = stoneOf(color);
  const opp = stoneOf(otherColor(color));

  const winning = candidates.find((p) => winsAt(board, p, color, rules));
  if (winning) return winning;
  const block = candidates.find((p) => winsAt(board, p, otherColor(color), rules));
  if (block) return block;

  let best = candidates[0] ?? null;
  let bestScore = -Infinity;
  for (const p of candidates) {
    // 공격을 조금 더 높게 친다. 같은 점수면 가운데에 가까운 수
    const score = shapeScore(board, p, me) * 1.1 + shapeScore(board, p, opp) - centerDistance(p) * 0.01;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

/** 첫 수는 가운데(H8). 그 뒤에는 돌 주변 2칸 안의 빈칸만 본다 */
function candidatePoints(board: Board): Point[] {
  const center = Math.floor(GOMOKU_SIZE / 2);
  if (board.every((c) => c === EMPTY)) return [{ x: center, y: center }];
  const out: Point[] = [];
  for (let y = 0; y < GOMOKU_SIZE; y += 1) {
    for (let x = 0; x < GOMOKU_SIZE; x += 1) {
      if (board[indexOf(x, y)] !== EMPTY) continue;
      if (hasNeighbor(board, { x, y }, 'any', 2)) out.push({ x, y });
    }
  }
  return out;
}

function winsAt(board: Board, p: Point, color: GomokuColor, rules: GomokuRuleOptions): boolean {
  if (forbiddenReason(board, p, color, rules) !== null) return false;
  const next = [...board];
  next[indexOf(p.x, p.y)] = stoneOf(color);
  return winningLine(next, p, color, rules) !== null;
}

function centerDistance(p: Point): number {
  const c = (GOMOKU_SIZE - 1) / 2;
  return Math.abs(p.x - c) + Math.abs(p.y - c);
}

/** 연속 개수와 열린 끝 수로 매기는 점수표 */
const SCORE: Record<number, readonly [number, number, number]> = {
  // [막힘 0개(양쪽 열림), 한쪽 막힘, 양쪽 막힘]
  4: [50_000, 5_000, 0],
  3: [3_000, 300, 0],
  2: [200, 30, 0],
  1: [10, 2, 0],
};

/** p에 stone을 두었다고 보고 네 방향의 모양 점수를 더한다 */
function shapeScore(board: Board, p: Point, stone: Stone): number {
  let total = 0;
  for (const [dx, dy] of DIRECTIONS) {
    let count = 1;
    let blocked = 0;
    for (const sign of [1, -1]) {
      let k = 1;
      for (;;) {
        const x = p.x + sign * k * dx;
        const y = p.y + sign * k * dy;
        const c: Cell | undefined = inBounds(x, y) ? board[indexOf(x, y)] : undefined;
        if (c === stone) {
          count += 1;
          k += 1;
          continue;
        }
        if (c !== EMPTY) blocked += 1;
        break;
      }
    }
    if (count >= 5) total += 1_000_000;
    else total += SCORE[count]?.[blocked] ?? 0;
  }
  return total;
}
