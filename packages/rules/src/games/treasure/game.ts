/**
 * 보물 찾기 룰 (docs/specs/treasure.md BH-01~BH-07). 순수 함수만 둔다.
 * 보물 위치와 무작위 값은 서버가 난수로 정해 넘긴다 (원칙 3, 5).
 */

/** BH-01: 9×9 칸. 칸 번호는 열 A~I, 행 1~9 */
export const GRID_SIZE = 9;
export const GRID_CELLS = GRID_SIZE * GRID_SIZE;
/** BH-07: 동점 재대결은 최대 이만큼 */
export const MAX_REPLAYS = 5;

export interface Cell {
  readonly x: number;
  readonly y: number;
}

export function inGrid(x: unknown, y: unknown): boolean {
  return (
    typeof x === 'number' &&
    typeof y === 'number' &&
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x < GRID_SIZE &&
    y < GRID_SIZE
  );
}

/** 0~80 번호 ↔ 칸 (행 우선) */
export function cellOf(index: number): Cell {
  return { x: index % GRID_SIZE, y: Math.floor(index / GRID_SIZE) };
}

export function cellLabel(c: Cell): string {
  return `${'ABCDEFGHI'[c.x] ?? '?'}${c.y + 1}`;
}

/** BH-05: 거리의 제곱 (정수). 클수록 멀다 */
export function distanceSq(a: Cell, b: Cell): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

export interface Pick extends Cell {
  readonly seat: number;
}

export interface RoundResult {
  /** 거리 먼 순서 (같으면 좌석 순서) */
  readonly ranked: readonly {
    readonly seat: number;
    readonly x: number;
    readonly y: number;
    readonly distSq: number;
  }[];
  /** 가장 먼 거리의 제곱 */
  readonly maxSq: number;
  /** 가장 먼 사람들. 하나면 당첨 (BH-06), 둘 이상이면 동점 (BH-07) */
  readonly far: readonly number[];
}

/** BH-04~BH-07: 보물에서 가장 먼 사람(들)을 가린다 */
export function resolveRound(treasure: Cell, picks: readonly Pick[]): RoundResult {
  if (picks.length === 0) throw new Error('no picks');
  const ranked = picks
    .map((p) => ({ seat: p.seat, x: p.x, y: p.y, distSq: distanceSq(treasure, p) }))
    .sort((a, b) => b.distSq - a.distSq || a.seat - b.seat);
  const maxSq = ranked[0]?.distSq ?? 0;
  return { ranked, maxSq, far: ranked.filter((r) => r.distSq === maxSq).map((r) => r.seat) };
}
