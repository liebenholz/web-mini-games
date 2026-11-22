import { describe, expect, it } from 'vitest';
import { defaultSelection, normalizeSelection, panelState } from '../src/bidPanel.js';

describe('선언 패널 (명세 8장)', () => {
  it('기본값은 가장 낮은 합법 선언, 첫 턴에는 라이어 비활성 (R-06)', () => {
    const input = { currentBid: null, totalDice: 10, myTurn: true };
    expect(defaultSelection(input)).toEqual({ quantity: 1, face: 2 });
    const s = panelState(input, null);
    expect(s.canBid).toBe(true);
    expect(s.canLiar).toBe(false);
    expect(s.canDecrease).toBe(false);
  });

  it('TC-01: 직전 3이 4개면 4개에서 2·3은 불가, 개수를 늘리면 가능', () => {
    const input = { currentBid: { quantity: 4, face: 3 as const }, totalDice: 15, myTurn: true };
    expect(defaultSelection(input)).toEqual({ quantity: 4, face: 4 });
    expect(normalizeSelection(input, { quantity: 4, face: 2 })).toEqual({ quantity: 5, face: 2 });
    const s = panelState(input, { quantity: 4, face: 5 });
    expect(s.canDecrease).toBe(false);
    expect(s.canIncrease).toBe(true);
    expect(s.canLiar).toBe(true);
  });

  it('TC-05: 직전 (총 주사위 수, 6)이면 라이어만 활성', () => {
    const input = { currentBid: { quantity: 10, face: 6 as const }, totalDice: 10, myTurn: true };
    const s = panelState(input, null);
    expect(s.liarOnly).toBe(true);
    expect(s.canBid).toBe(false);
    expect(s.canLiar).toBe(true);
    expect(Object.values(s.faceEnabled).every((v) => !v)).toBe(true);
  });

  it('내 차례가 아니면 모두 비활성', () => {
    const s = panelState({ currentBid: { quantity: 2, face: 3 }, totalDice: 10, myTurn: false }, null);
    expect([s.canBid, s.canLiar, s.canIncrease, s.canDecrease]).toEqual([false, false, false, false]);
  });

  it('최대 개수에서는 + 비활성', () => {
    const s = panelState({ currentBid: null, totalDice: 3, myTurn: true }, { quantity: 3, face: 4 });
    expect(s.canIncrease).toBe(false);
  });
});
