import { describe, expect, it } from 'vitest';
import { seatPoints, sideMargin, type TableGeometry } from '../src/game/seatLayout.js';

const mobile: TableGeometry = { width: 360, height: 420, cy: 180, ry: 118, compact: true };
const desktop: TableGeometry = { width: 960, height: 520, cy: 234, ry: 161, compact: false };

describe('상대 좌석 배치', () => {
  it.each([mobile, desktop])('5명: 왼쪽 위·아래, 오른쪽 위·아래가 같은 세로줄에 선다', (g) => {
    const [lowerLeft, upperLeft, top, upperRight, lowerRight] = seatPoints(5, g);
    expect(lowerLeft!.x).toBe(upperLeft!.x);
    expect(lowerRight!.x).toBe(upperRight!.x);
    // 좌우 대칭, 위 좌석은 가운데
    expect(lowerLeft!.x + lowerRight!.x).toBeCloseTo(g.width);
    expect(top!.x).toBe(g.width / 2);
    // 같은 가로줄
    expect(upperLeft!.y).toBe(upperRight!.y);
    expect(lowerLeft!.y).toBe(lowerRight!.y);
    // 위에서 아래 순서: 위 < 위쪽 < 아래쪽
    expect(top!.y).toBeLessThan(upperLeft!.y);
    expect(upperLeft!.y).toBeLessThan(lowerLeft!.y);
  });

  it('R-02: 배열 순서가 시계 방향 (왼쪽 아래 → 왼쪽 위 → 위 → 오른쪽 위 → 오른쪽 아래)', () => {
    expect(seatPoints(5, mobile).map((p) => p.slot)).toEqual([
      'lowerLeft',
      'upperLeft',
      'top',
      'upperRight',
      'lowerRight',
    ]);
    expect(seatPoints(4, mobile).map((p) => p.slot)).toEqual([
      'lowerLeft',
      'upperLeft',
      'upperRight',
      'lowerRight',
    ]);
    expect(seatPoints(3, mobile).map((p) => p.slot)).toEqual(['upperLeft', 'top', 'upperRight']);
    expect(seatPoints(2, mobile).map((p) => p.slot)).toEqual(['upperLeft', 'upperRight']);
    expect(seatPoints(1, mobile).map((p) => p.slot)).toEqual(['top']);
    expect(seatPoints(0, mobile)).toEqual([]);
  });

  it('360px에서도 좌우 좌석은 가장자리 여백 안쪽에 있다 (공개 때 주사위 줄이 잘리지 않음)', () => {
    for (const p of seatPoints(5, mobile)) {
      expect(p.x).toBeGreaterThanOrEqual(sideMargin(true));
      expect(p.x).toBeLessThanOrEqual(mobile.width - sideMargin(true));
    }
  });
});
