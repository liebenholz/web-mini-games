import { describe, expect, it } from 'vitest';
import { gomoku } from '../src/index.js';

const { drawOfferCheck, myMovesLeft, DRAW_MIN_STONES, DRAW_RETRY_STONES } = gomoku;

describe('오목 무승부 제안 시기 (G-15)', () => {
  it('GT-15: 59돌까지는 이르고, 60돌부터 제안할 수 있다', () => {
    expect(drawOfferCheck(0, 0)).toEqual({ ok: false, reason: 'EARLY', stonesLeft: 60 });
    expect(drawOfferCheck(59, 0)).toEqual({ ok: false, reason: 'EARLY', stonesLeft: 1 });
    expect(drawOfferCheck(DRAW_MIN_STONES, 0)).toEqual({ ok: true });
    expect(drawOfferCheck(120, 0)).toEqual({ ok: true });
  });

  it('GT-17: 거절당하면 전체 20돌(내 수 10번) 뒤에 다시 제안할 수 있다', () => {
    const blockedUntil = 64 + DRAW_RETRY_STONES;
    expect(drawOfferCheck(64, blockedUntil)).toEqual({ ok: false, reason: 'COOLDOWN', stonesLeft: 20 });
    expect(drawOfferCheck(83, blockedUntil)).toEqual({ ok: false, reason: 'COOLDOWN', stonesLeft: 1 });
    expect(drawOfferCheck(84, blockedUntil)).toEqual({ ok: true });
  });

  it('화면의 "내 수 N번": 남은 돌의 절반, 올림', () => {
    expect([20, 19, 2, 1].map(myMovesLeft)).toEqual([10, 10, 1, 1]);
  });
});
