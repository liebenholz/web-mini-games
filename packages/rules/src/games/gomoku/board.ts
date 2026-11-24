/**
 * 오목 판 (명세 docs/specs/gomoku.md G-01). 15×15 교차점을 길이 225 배열로 둔다.
 * 좌표 x는 열(0=A … 14=O, 왼쪽→오른쪽), y는 행(0=1행 … 14=15행, 아래→위).
 * 순수 함수만 둔다. 난수, 시간, I/O 없음 (CLAUDE.md 원칙 3).
 */
export const GOMOKU_SIZE = 15;
export const GOMOKU_CELLS = GOMOKU_SIZE * GOMOKU_SIZE;

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
export type Stone = typeof BLACK | typeof WHITE;
export type Cell = typeof EMPTY | Stone;

export type GomokuColor = 'black' | 'white';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** 판 상태. 서버와 클라이언트가 같은 배열을 주고받는다 */
export type Board = readonly Cell[];

/** 네 방향: 가로, 세로, 두 대각선 */
export const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

const COLUMNS = 'ABCDEFGHIJKLMNO';

export function emptyBoard(): Cell[] {
  return Array.from({ length: GOMOKU_CELLS }, () => EMPTY);
}

export function inBounds(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < GOMOKU_SIZE && y < GOMOKU_SIZE;
}

export function indexOf(x: number, y: number): number {
  return y * GOMOKU_SIZE + x;
}

export function pointOf(index: number): Point {
  return { x: index % GOMOKU_SIZE, y: Math.floor(index / GOMOKU_SIZE) };
}

export function stoneOf(color: GomokuColor): Stone {
  return color === 'black' ? BLACK : WHITE;
}

export function otherColor(color: GomokuColor): GomokuColor {
  return color === 'black' ? 'white' : 'black';
}

/** 사람이 읽는 좌표 (G-01): x=7, y=7 → "H8" */
export function coordLabel(p: Point): string {
  return `${COLUMNS[p.x] ?? '?'}${p.y + 1}`;
}

/** "H8" → {x: 7, y: 7}. 형식이 틀리면 null */
export function parseCoord(label: string): Point | null {
  const m = /^([A-Oa-o])(\d{1,2})$/.exec(label.trim());
  if (!m) return null;
  const x = COLUMNS.indexOf((m[1] ?? '').toUpperCase());
  const y = Number(m[2]) - 1;
  return inBounds(x, y) ? { x, y } : null;
}

/** 글자 그림으로 판을 만든다 (테스트·문서용). 아래 줄이 1행. 'X' 흑, 'O' 백, '.' 빈칸 */
export function boardFromRows(rows: readonly string[]): Cell[] {
  const board = emptyBoard();
  const top = rows.length - 1;
  rows.forEach((row, r) => {
    const y = top - r;
    [...row.replace(/\s+/g, '')].forEach((ch, x) => {
      if (!inBounds(x, y)) return;
      board[indexOf(x, y)] = ch === 'X' ? BLACK : ch === 'O' ? WHITE : EMPTY;
    });
  });
  return board;
}

export function isBoardFull(board: Board): boolean {
  return board.every((c) => c !== EMPTY);
}
