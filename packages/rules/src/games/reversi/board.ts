/**
 * 리버시 판 (docs/specs/reversi.md RV-01). 8×8 칸을 길이 64 배열로 둔다.
 * 좌표 x는 열(0=A … 7=H, 왼쪽→오른쪽), y는 행(0=1행 … 7=8행, 위→아래).
 * 순수 함수만 둔다. 난수, 시간, I/O 없음 (CLAUDE.md 원칙 3).
 */
export const REVERSI_SIZE = 8;
export const REVERSI_CELLS = REVERSI_SIZE * REVERSI_SIZE;

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
export type Stone = typeof BLACK | typeof WHITE;
export type Cell = typeof EMPTY | Stone;

export type ReversiColor = 'black' | 'white';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** 판 상태. 서버와 클라이언트가 같은 배열을 주고받는다 */
export type Board = readonly Cell[];

/** 여덟 방향: 가로, 세로, 대각선 (RV-03) */
export const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const COLUMNS = 'ABCDEFGH';

export function inBounds(x: number, y: number): boolean {
  return (
    Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < REVERSI_SIZE && y < REVERSI_SIZE
  );
}

export function indexOf(p: Point): number {
  return p.y * REVERSI_SIZE + p.x;
}

export function pointOf(index: number): Point {
  return { x: index % REVERSI_SIZE, y: Math.floor(index / REVERSI_SIZE) };
}

export function stoneOf(color: ReversiColor): Stone {
  return color === 'black' ? BLACK : WHITE;
}

export function colorOf(stone: Stone): ReversiColor {
  return stone === BLACK ? 'black' : 'white';
}

export function otherColor(color: ReversiColor): ReversiColor {
  return color === 'black' ? 'white' : 'black';
}

/** "D3" 같은 이름 (열 A~H, 행 1~8) */
export function coordLabel(p: Point): string {
  return `${COLUMNS[p.x] ?? '?'}${p.y + 1}`;
}

export function parseCoord(label: string): Point | null {
  const m = /^([A-Ha-h])([1-8])$/.exec(label.trim());
  if (!m?.[1] || !m[2]) return null;
  return { x: COLUMNS.indexOf(m[1].toUpperCase()), y: Number(m[2]) - 1 };
}

export function emptyBoard(): Cell[] {
  return Array.from({ length: REVERSI_CELLS }, () => EMPTY);
}

/** RV-01: 가운데 네 칸. D4 백, E4 흑, D5 흑, E5 백 */
export function initialBoard(): Cell[] {
  const board = emptyBoard();
  board[indexOf({ x: 3, y: 3 })] = WHITE;
  board[indexOf({ x: 4, y: 3 })] = BLACK;
  board[indexOf({ x: 3, y: 4 })] = BLACK;
  board[indexOf({ x: 4, y: 4 })] = WHITE;
  return board;
}
