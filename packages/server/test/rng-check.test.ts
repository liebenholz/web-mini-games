import { describe, expect, it } from 'vitest';
import { chiSquareUniform, gammaQ } from '../src/framework/chiSquare.js';
import { createSeededRng, rollDie, shuffle, type Rng } from '../src/framework/rng.js';
import { runRngChecks } from '../src/framework/rngCheck.js';

describe('TC-15: 카이제곱 검정', () => {
  it('알려진 임계값에서 p값이 맞다', () => {
    // 자유도 5: 11.0705 → 0.05, 15.0863 → 0.01. 자유도 1: 3.8415 → 0.05
    expect(gammaQ(5 / 2, 11.0705 / 2)).toBeCloseTo(0.05, 4);
    expect(gammaQ(5 / 2, 15.0863 / 2)).toBeCloseTo(0.01, 4);
    expect(gammaQ(1 / 2, 3.8415 / 2)).toBeCloseTo(0.05, 4);
    // 자유도 53: 70.99 → 0.05
    expect(gammaQ(53 / 2, 70.993 / 2)).toBeCloseTo(0.05, 3);
    expect(gammaQ(3, 0)).toBe(1);
  });

  it('완전히 고르면 통계량 0, p = 1. 한쪽으로 쏠리면 p가 아주 작다', () => {
    expect(chiSquareUniform([100, 100, 100, 100, 100, 100])).toEqual({ statistic: 0, df: 5, pValue: 1 });
    expect(chiSquareUniform([200, 100, 100, 100, 100, 0]).pValue).toBeLessThan(1e-10);
  });
});

describe('TC-15: 게임 난수 함수 검증', () => {
  it('rollDie는 1~6, shuffle은 원본을 바꾸지 않고 같은 카드를 돌려준다', () => {
    const rng = createSeededRng(3);
    for (let i = 0; i < 100; i += 1) expect(rollDie(rng)).toBeGreaterThanOrEqual(1);
    const deck = ['a', 'b', 'c', 'd'];
    const s = shuffle(deck, rng);
    expect(deck).toEqual(['a', 'b', 'c', 'd']);
    expect([...s].sort()).toEqual(deck);
  });

  it('고른 난수(시드 고정)는 모든 검정을 통과한다', () => {
    const report = runRngChecks(createSeededRng(20261126), 30_000);
    expect(report.checks.map((c) => c.id)).toEqual([
      'dice-face',
      'dice-pair',
      'pick-2',
      'pick-3',
      'pick-4',
      'pick-5',
      'pick-6',
      'shuffle-top',
      'shuffle-place',
      'bulls-digits',
    ]);
    expect(report.perTestAlpha).toBeCloseTo(0.001);
    expect(report.passed).toBe(true);
  });

  it('조금만 치우친 난수도 잡아낸다 (6이 5% 덜 나옴)', () => {
    const base = createSeededRng(7);
    const biased: Rng = {
      id: () => base.id(),
      int: (max) => {
        const v = base.int(max);
        // 마지막 값이 나오면 20번에 1번 다시 뽑는다
        return v === max - 1 && base.int(20) === 0 ? base.int(max - 1) : v;
      },
    };
    const report = runRngChecks(biased, 100_000);
    expect(report.checks.find((c) => c.id === 'dice-face')?.pValue).toBeLessThan(report.perTestAlpha);
    expect(report.passed).toBe(false);
  });
});
