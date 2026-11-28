import { describe, expect, it } from 'vitest';
import { treasure } from '../src/index.js';

const {
  resolveRound,
  distanceSq,
  inGrid,
  cellLabel,
  randomCell,
  parseTreasureOptions,
  DEFAULT_TREASURE_OPTIONS,
} = treasure;

describe('보물 찾기 판과 거리 (BH-01, BH-05)', () => {
  it('9×9 안의 정수 칸만 유효, 칸 이름은 열 A~I 행 1~9', () => {
    expect(inGrid(0, 0)).toBe(true);
    expect(inGrid(8, 8)).toBe(true);
    for (const [x, y] of [
      [9, 0],
      [0, 9],
      [-1, 3],
      [2.5, 1],
      ['3', 1],
      [Number.NaN, 1],
    ] as const)
      expect(inGrid(x, y)).toBe(false);
    expect([cellLabel({ x: 0, y: 0 }), cellLabel({ x: 8, y: 8 }), cellLabel({ x: 4, y: 3 })]).toEqual([
      'A1',
      'I9',
      'E4',
    ]);
  });

  it('거리의 제곱은 열 차이² + 행 차이²', () => {
    expect(distanceSq({ x: 4, y: 4 }, { x: 4, y: 4 })).toBe(0);
    expect(distanceSq({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(25);
    expect(distanceSq({ x: 0, y: 8 }, { x: 8, y: 8 })).toBe(64);
  });
});

describe('보물 찾기 판정 (BH-04~BH-07)', () => {
  it('명세 예시: 보물 E5, A=E5 0, B=C4 5, C=A9 32, D=I1 32 → C와 D 동점', () => {
    const r = resolveRound({ x: 4, y: 4 }, [
      { seat: 0, x: 4, y: 4 },
      { seat: 1, x: 2, y: 3 },
      { seat: 2, x: 0, y: 8 },
      { seat: 3, x: 8, y: 0 },
    ]);
    expect(r.ranked.map((p) => [p.seat, p.distSq])).toEqual([
      [2, 32],
      [3, 32],
      [1, 5],
      [0, 0],
    ]);
    expect(r.maxSq).toBe(32);
    expect(r.far).toEqual([2, 3]);
  });

  it('가장 먼 사람이 하나면 그 사람이 당첨', () => {
    const r = resolveRound({ x: 4, y: 3 }, [
      { seat: 0, x: 1, y: 4 },
      { seat: 1, x: 8, y: 8 },
      { seat: 2, x: 4, y: 4 },
    ]);
    expect(r.far).toEqual([1]);
  });

  it('모두 같은 칸을 골라도 모두 동점', () => {
    const r = resolveRound({ x: 0, y: 0 }, [
      { seat: 2, x: 5, y: 5 },
      { seat: 0, x: 5, y: 5 },
    ]);
    expect(r.far).toEqual([0, 2]);
  });
});

describe('보물 찾기 봇 (BH-13)', () => {
  it('항상 판 안, 81칸 모두 나올 수 있다', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 81; i += 1) {
      const c = randomCell(i / 81 + 0.001);
      expect(inGrid(c.x, c.y)).toBe(true);
      seen.add(`${c.x},${c.y}`);
    }
    expect(seen.size).toBe(81);
    expect(randomCell(0.9999999)).toEqual({ x: 8, y: 8 });
  });

  it('HT-08: 봇끼리 1,000판 모두 끝나고, 당첨은 자리마다 고르게 나온다', () => {
    let seed = 9;
    const roll = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296;
    };
    const players = 5;
    const losers = new Array<number>(players).fill(0);
    let replays = 0;
    for (let game = 0; game < 1000; game += 1) {
      let seats = Array.from({ length: players }, (_, i) => i);
      let round = 0;
      for (;;) {
        const t = randomCell(roll());
        const r = resolveRound(
          t,
          seats.map((seat) => ({ seat, ...randomCell(roll()) })),
        );
        if (r.far.length === 1 || round >= treasure.MAX_REPLAYS) {
          const loser = r.far.length === 1 ? r.far[0]! : r.far[Math.floor(roll() * r.far.length)]!;
          losers[loser] = (losers[loser] ?? 0) + 1;
          break;
        }
        seats = [...r.far];
        round += 1;
        replays += 1;
      }
    }
    expect(replays).toBeGreaterThan(0);
    for (const n of losers) expect(n).toBeGreaterThan(130);
  });
});

describe('보물 찾기 옵션 (4장)', () => {
  it('기본값 6명, 15초, 봇 채우기, 비공개. 2~10명, 10/15/30초만 허용', () => {
    expect(DEFAULT_TREASURE_OPTIONS).toEqual({
      maxPlayers: 6,
      pickSeconds: 15,
      fillWithBots: true,
      isPrivate: true,
    });
    expect(parseTreasureOptions({ maxPlayers: 11 })).toMatchObject({ ok: false, field: 'maxPlayers' });
    expect(parseTreasureOptions({ maxPlayers: 1 })).toMatchObject({ ok: false, field: 'maxPlayers' });
    expect(parseTreasureOptions({ maxPlayers: 10 })).toMatchObject({ ok: true });
    expect(parseTreasureOptions({ pickSeconds: 60 })).toMatchObject({ ok: false, field: 'pickSeconds' });
    expect(parseTreasureOptions({ isPrivate: 'x' })).toMatchObject({ ok: false, field: 'isPrivate' });
    expect(parseTreasureOptions({ pickSeconds: 30, foo: 1 })).toEqual({
      ok: true,
      options: { ...DEFAULT_TREASURE_OPTIONS, pickSeconds: 30 },
    });
  });
});
