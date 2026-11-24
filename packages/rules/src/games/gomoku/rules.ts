import {
  BLACK,
  type Board,
  type Cell,
  DIRECTIONS,
  EMPTY,
  type GomokuColor,
  inBounds,
  indexOf,
  type Point,
  type Stone,
  stoneOf,
} from './board.js';

/** 흑에게만 적용하는 금수 (G-07~G-10). 방장이 각각 켜고 끈다. 모두 켜면 렌주 */
export interface GomokuRuleOptions {
  readonly forbidDoubleThree: boolean;
  readonly forbidDoubleFour: boolean;
  readonly forbidOverline: boolean;
}

/** 기본값: 모두 켬 = 렌주 (명세 4장, 12장) */
export const DEFAULT_GOMOKU_RULES: GomokuRuleOptions = Object.freeze({
  forbidDoubleThree: true,
  forbidDoubleFour: true,
  forbidOverline: true,
});

export type ForbiddenReason = 'double-three' | 'double-four' | 'overline';

export type PlaceCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'INVALID_MOVE' | 'OCCUPIED' }
  | { readonly ok: false; readonly code: 'FORBIDDEN_MOVE'; readonly reason: ForbiddenReason };

/** 금수 재귀 판정 깊이 (명세 5장: 열린 3의 완성점이 금수인지 다시 본다). 실전 모양은 2단계면 충분하다 */
export const FORBIDDEN_DEPTH = 3;

type Grid = Cell[];

/** (x, y)를 지나는 dir 방향의 연속 돌 구간. (x, y)에 color가 놓여 있다고 본다 */
function runAt(
  grid: Grid,
  x: number,
  y: number,
  dx: number,
  dy: number,
  color: Stone,
): { from: number; to: number } {
  let from = 0;
  while (
    inBounds(x + (from - 1) * dx, y + (from - 1) * dy) &&
    grid[indexOf(x + (from - 1) * dx, y + (from - 1) * dy)] === color
  )
    from -= 1;
  let to = 0;
  while (
    inBounds(x + (to + 1) * dx, y + (to + 1) * dy) &&
    grid[indexOf(x + (to + 1) * dx, y + (to + 1) * dy)] === color
  )
    to += 1;
  return { from, to };
}

function runLength(grid: Grid, x: number, y: number, dx: number, dy: number, color: Stone): number {
  const r = runAt(grid, x, y, dx, dy, color);
  return r.to - r.from + 1;
}

/** 한 방향에서 이 길이가 "오목"으로 인정되는가 (G-04, G-05) */
function isWinningLength(len: number, color: Stone, rules: GomokuRuleOptions): boolean {
  if (color === BLACK && rules.forbidOverline) return len === 5;
  return len >= 5;
}

/**
 * dir 방향에서 (x, y)의 돌과 이어져 "오목"을 완성하는 빈칸들 (오프셋).
 * 4가 있다는 것은 이런 빈칸이 하나 이상 있다는 뜻이다 (명세 5장 "4")
 */
function completionOffsets(
  grid: Grid,
  x: number,
  y: number,
  dx: number,
  dy: number,
  color: Stone,
  rules: GomokuRuleOptions,
): number[] {
  const out: number[] = [];
  for (let k = -4; k <= 4; k += 1) {
    if (k === 0) continue;
    const px = x + k * dx;
    const py = y + k * dy;
    if (!inBounds(px, py)) continue;
    const pi = indexOf(px, py);
    if (grid[pi] !== EMPTY) continue;
    grid[pi] = color;
    const r = runAt(grid, x, y, dx, dy, color);
    const connected = k >= r.from && k <= r.to;
    if (connected && isWinningLength(r.to - r.from + 1, color, rules)) out.push(k);
    grid[pi] = EMPTY;
  }
  return out;
}

/** dir 방향의 4 개수. 열린 4(_XXXX_)는 완성점이 둘이어도 4 하나로 센다. X_XXX_X 같은 한 줄 4-4는 둘이다 */
function fourCount(
  grid: Grid,
  x: number,
  y: number,
  dx: number,
  dy: number,
  color: Stone,
  rules: GomokuRuleOptions,
): number {
  const c = completionOffsets(grid, x, y, dx, dy, color, rules);
  if (c.length === 2 && isOpenFourPair(c)) return 1;
  return c.length;
}

/** 두 완성점이 5칸 떨어져 있으면 그 사이 연속 4개가 열린 4다 */
function isOpenFourPair(offsets: readonly number[]): boolean {
  const [a, b] = offsets;
  return a !== undefined && b !== undefined && Math.abs(a - b) === 5;
}

function isOpenFour(
  grid: Grid,
  x: number,
  y: number,
  dx: number,
  dy: number,
  color: Stone,
  rules: GomokuRuleOptions,
): boolean {
  const c = completionOffsets(grid, x, y, dx, dy, color, rules);
  return c.length === 2 && isOpenFourPair(c);
}

/**
 * dir 방향이 열린 3인가 (명세 5장): 같은 줄의 빈칸 하나에 더 두면 (x, y)를 포함한 열린 4가 되고,
 * 그 빈칸이 흑에게 금수가 아니다 (렌주 재귀 판정)
 */
function isOpenThree(
  grid: Grid,
  x: number,
  y: number,
  dx: number,
  dy: number,
  rules: GomokuRuleOptions,
  depth: number,
): boolean {
  for (let k = -4; k <= 4; k += 1) {
    if (k === 0) continue;
    const qx = x + k * dx;
    const qy = y + k * dy;
    if (!inBounds(qx, qy)) continue;
    const qi = indexOf(qx, qy);
    if (grid[qi] !== EMPTY) continue;
    grid[qi] = BLACK;
    const open = isOpenFour(grid, x, y, dx, dy, BLACK, rules);
    grid[qi] = EMPTY;
    if (!open) continue;
    if (depth <= 0 || forbiddenOnGrid(grid, qx, qy, rules, depth - 1) === null) return true;
  }
  return false;
}

/** 흑이 (x, y)에 두면 금수인가. grid에서 (x, y)는 빈칸이어야 하고, 함수가 끝나면 grid는 그대로다 */
function forbiddenOnGrid(
  grid: Grid,
  x: number,
  y: number,
  rules: GomokuRuleOptions,
  depth: number,
): ForbiddenReason | null {
  if (!rules.forbidDoubleThree && !rules.forbidDoubleFour && !rules.forbidOverline) return null;
  const i = indexOf(x, y);
  grid[i] = BLACK;
  try {
    // G-06: 정확히 5가 되면 금수가 아니라 승리다
    if (DIRECTIONS.some(([dx, dy]) => runLength(grid, x, y, dx, dy, BLACK) === 5)) return null;
    // G-10 장목
    if (rules.forbidOverline && DIRECTIONS.some(([dx, dy]) => runLength(grid, x, y, dx, dy, BLACK) >= 6))
      return 'overline';
    const fours = DIRECTIONS.map(([dx, dy]) => fourCount(grid, x, y, dx, dy, BLACK, rules));
    // G-09 4-4 (한 줄 4-4 포함)
    if (rules.forbidDoubleFour && fours.reduce((a, b) => a + b, 0) >= 2) return 'double-four';
    // G-08 3-3: 4가 된 줄은 3으로 세지 않는다
    if (rules.forbidDoubleThree) {
      let threes = 0;
      for (let d = 0; d < DIRECTIONS.length; d += 1) {
        const dir = DIRECTIONS[d];
        if (!dir || (fours[d] ?? 0) > 0) continue;
        if (isOpenThree(grid, x, y, dir[0], dir[1], rules, depth)) threes += 1;
        if (threes >= 2) return 'double-three';
      }
    }
    return null;
  } finally {
    grid[i] = EMPTY;
  }
}

/** 흑이 p에 두면 금수인지, 금수라면 무엇 때문인지 (G-07~G-10). 백은 항상 null */
export function forbiddenReason(
  board: Board,
  p: Point,
  color: GomokuColor,
  rules: GomokuRuleOptions,
): ForbiddenReason | null {
  if (color !== 'black' || !inBounds(p.x, p.y) || board[indexOf(p.x, p.y)] !== EMPTY) return null;
  return forbiddenOnGrid([...board], p.x, p.y, rules, FORBIDDEN_DEPTH);
}

/** 착수 검증 (G-03, G-07, GE-02~GE-04). 차례 검사는 서버가 한다 */
export function checkPlace(board: Board, p: Point, color: GomokuColor, rules: GomokuRuleOptions): PlaceCheck {
  if (!inBounds(p.x, p.y)) return { ok: false, code: 'INVALID_MOVE' };
  if (board[indexOf(p.x, p.y)] !== EMPTY) return { ok: false, code: 'OCCUPIED' };
  const reason = forbiddenReason(board, p, color, rules);
  if (reason) return { ok: false, code: 'FORBIDDEN_MOVE', reason };
  return { ok: true };
}

/**
 * p에 color 돌이 놓인 판에서, 그 돌로 이긴 줄 (G-04, G-05, G-06).
 * 이겼으면 그 줄의 돌 좌표(5개, 백 장목이면 6개 이상), 아니면 null
 */
export function winningLine(
  board: Board,
  p: Point,
  color: GomokuColor,
  rules: GomokuRuleOptions,
): Point[] | null {
  const stone = stoneOf(color);
  if (!inBounds(p.x, p.y) || board[indexOf(p.x, p.y)] !== stone) return null;
  const grid = [...board];
  for (const [dx, dy] of DIRECTIONS) {
    const r = runAt(grid, p.x, p.y, dx, dy, stone);
    if (isWinningLength(r.to - r.from + 1, stone, rules)) {
      const line: Point[] = [];
      for (let k = r.from; k <= r.to; k += 1) line.push({ x: p.x + k * dx, y: p.y + k * dy });
      return line;
    }
  }
  return null;
}

/** 판에 돌을 놓은 새 판을 돌려준다 (원래 판은 그대로) */
export function placeStone(board: Board, p: Point, color: GomokuColor): Cell[] {
  const next = [...board];
  next[indexOf(p.x, p.y)] = stoneOf(color);
  return next;
}

/** 흑이 지금 둘 수 없는 빈칸 목록 (화면의 빨간 X, G-34) */
export function forbiddenPoints(
  board: Board,
  rules: GomokuRuleOptions,
): { point: Point; reason: ForbiddenReason }[] {
  const out: { point: Point; reason: ForbiddenReason }[] = [];
  if (!rules.forbidDoubleThree && !rules.forbidDoubleFour && !rules.forbidOverline) return out;
  const grid = [...board];
  for (let i = 0; i < grid.length; i += 1) {
    if (grid[i] !== EMPTY) continue;
    const point = { x: i % 15, y: Math.floor(i / 15) };
    // 주변 2칸에 흑이 없으면 금수가 될 수 없다
    if (!hasNeighbor(grid, point, BLACK, 2)) continue;
    const reason = forbiddenOnGrid(grid, point.x, point.y, rules, FORBIDDEN_DEPTH);
    if (reason) out.push({ point, reason });
  }
  return out;
}

export function hasNeighbor(board: Board, p: Point, color: Cell | 'any', radius: number): boolean {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const x = p.x + dx;
      const y = p.y + dy;
      if (!inBounds(x, y)) continue;
      const c = board[indexOf(x, y)];
      if (color === 'any' ? c !== EMPTY : c === color) return true;
    }
  }
  return false;
}
