import {
  type Board,
  type Cell,
  DIRECTIONS,
  EMPTY,
  inBounds,
  indexOf,
  otherColor,
  type Point,
  REVERSI_CELLS,
  REVERSI_SIZE,
  type ReversiColor,
  stoneOf,
  BLACK,
  WHITE,
} from './board.js';

/** 둘 수 있는 자리와 그 수로 뒤집히는 돌 */
export interface ReversiMove extends Point {
  readonly flips: readonly Point[];
}

/**
 * RV-03: p에 color를 두면 뒤집히는 상대 돌. 빈칸이 아니거나 판 밖이면 빈 배열.
 * 한 방향에서 상대 돌이 이어지다 내 돌로 끝나야 그 방향의 돌을 뒤집는다
 */
export function flipsAt(board: Board, p: Point, color: ReversiColor): Point[] {
  if (!inBounds(p.x, p.y) || board[indexOf(p)] !== EMPTY) return [];
  const me = stoneOf(color);
  const opp = stoneOf(otherColor(color));
  const out: Point[] = [];
  for (const [dx, dy] of DIRECTIONS) {
    const line: Point[] = [];
    let x = p.x + dx;
    let y = p.y + dy;
    while (inBounds(x, y) && board[indexOf({ x, y })] === opp) {
      line.push({ x, y });
      x += dx;
      y += dy;
    }
    if (line.length > 0 && inBounds(x, y) && board[indexOf({ x, y })] === me) out.push(...line);
  }
  return out;
}

/** RV-04: 한 개 이상 뒤집을 수 있는 빈칸 (위→아래, 왼쪽→오른쪽 순서) */
export function legalMoves(board: Board, color: ReversiColor): ReversiMove[] {
  const out: ReversiMove[] = [];
  for (let y = 0; y < REVERSI_SIZE; y += 1)
    for (let x = 0; x < REVERSI_SIZE; x += 1) {
      const flips = flipsAt(board, { x, y }, color);
      if (flips.length > 0) out.push({ x, y, flips });
    }
  return out;
}

export function hasLegalMove(board: Board, color: ReversiColor): boolean {
  for (let i = 0; i < REVERSI_CELLS; i += 1) {
    if (board[i] !== EMPTY) continue;
    if (flipsAt(board, { x: i % REVERSI_SIZE, y: Math.floor(i / REVERSI_SIZE) }, color).length > 0)
      return true;
  }
  return false;
}

export type PlaceResult =
  | { readonly ok: true; readonly board: Cell[]; readonly flips: readonly Point[] }
  | { readonly ok: false; readonly code: 'INVALID_MOVE' };

/** RV-03, RV-04: 두고 뒤집은 새 판. 원래 판은 바꾸지 않는다 */
export function placeStone(board: Board, p: Point, color: ReversiColor): PlaceResult {
  const flips = flipsAt(board, p, color);
  if (flips.length === 0) return { ok: false, code: 'INVALID_MOVE' };
  const next = board.slice();
  const me = stoneOf(color);
  next[indexOf(p)] = me;
  for (const f of flips) next[indexOf(f)] = me;
  return { ok: true, board: next, flips };
}

export function countStones(board: Board): { readonly black: number; readonly white: number } {
  let black = 0;
  let white = 0;
  for (const c of board) {
    if (c === BLACK) black += 1;
    else if (c === WHITE) white += 1;
  }
  return { black, white };
}

/**
 * 방금 둔 사람(mover) 다음에 누가 둘지 (RV-05, RV-06).
 * - 상대가 둘 수 있으면 상대
 * - 상대는 못 두고 나는 둘 수 있으면 상대가 넘기고(passed) 다시 나
 * - 둘 다 못 두면 끝(null)
 */
export function nextTurn(
  board: Board,
  mover: ReversiColor,
): { readonly next: ReversiColor | null; readonly passed: ReversiColor | null } {
  const opp = otherColor(mover);
  if (hasLegalMove(board, opp)) return { next: opp, passed: null };
  if (hasLegalMove(board, mover)) return { next: mover, passed: opp };
  return { next: null, passed: null };
}

/** RV-07: 돌이 많은 쪽, 같으면 무승부(null) */
export function winnerOf(board: Board): ReversiColor | null {
  const { black, white } = countStones(board);
  if (black === white) return null;
  return black > white ? 'black' : 'white';
}
