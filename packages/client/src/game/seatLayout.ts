/**
 * 상대 좌석 배치. 나는 아래쪽 내 주사위 자리에 있고, 상대는 시계 방향(R-02)으로
 * 왼쪽 아래 → 왼쪽 위 → 위 → 오른쪽 위 → 오른쪽 아래 순서로 앉는다.
 *
 * 좌석을 세로줄 3개(왼쪽, 가운데, 오른쪽)와 가로줄 3개(위, 위쪽, 아래쪽)에 고정해서
 * 왼쪽 위·아래 좌석이 같은 세로줄에 서고, 인원이 바뀌어도 자리가 흔들리지 않게 한다.
 */
export type SeatSlot = 'lowerLeft' | 'upperLeft' | 'top' | 'upperRight' | 'lowerRight';

/** 상대 인원(1~5)별로 쓰는 자리. 배열 순서가 시계 방향 순서다 */
const SLOTS_BY_COUNT: Record<number, readonly SeatSlot[]> = {
  1: ['top'],
  2: ['upperLeft', 'upperRight'],
  3: ['upperLeft', 'top', 'upperRight'],
  4: ['lowerLeft', 'upperLeft', 'upperRight', 'lowerRight'],
  5: ['lowerLeft', 'upperLeft', 'top', 'upperRight', 'lowerRight'],
};

export interface SeatPoint {
  readonly slot: SeatSlot;
  readonly x: number;
  readonly y: number;
}

export interface TableGeometry {
  readonly width: number;
  readonly height: number;
  /** 가운데 선언 카드의 중심 높이 */
  readonly cy: number;
  /** 위쪽 끝 좌석까지의 세로 거리 */
  readonly ry: number;
  readonly compact: boolean;
}

/** 공개 때 주사위 줄(최대 5개)이 화면 밖으로 나가지 않는 최소 여백 */
export function sideMargin(compact: boolean): number {
  return compact ? 54 : 70;
}

export function seatPoints(count: number, g: TableGeometry): SeatPoint[] {
  const slots = SLOTS_BY_COUNT[Math.max(0, Math.min(5, count))] ?? [];
  // 좌우 세로줄: 화면 폭에 비례하되 가장자리 여백보다 안쪽으로 들어오지 않게
  const sideX = Math.max(sideMargin(g.compact), g.width * (g.compact ? 0.17 : 0.2));
  const x: Record<SeatSlot, number> = {
    lowerLeft: sideX,
    upperLeft: sideX,
    top: g.width / 2,
    upperRight: g.width - sideX,
    lowerRight: g.width - sideX,
  };
  const y: Record<SeatSlot, number> = {
    top: g.cy - g.ry,
    upperLeft: g.cy - g.ry * 0.62,
    upperRight: g.cy - g.ry * 0.62,
    // 공개 때 위쪽 좌석의 주사위 줄과 아래 좌석 아바타 사이에 여유를 둔다
    lowerLeft: g.cy + g.ry * 0.24,
    lowerRight: g.cy + g.ry * 0.24,
  };
  return slots.map((slot) => ({ slot, x: x[slot], y: y[slot] }));
}
