import { describe, expect, it } from 'vitest';
import { balloon } from '../src/index.js';

const {
  createBalloon,
  pump,
  endTurn,
  thresholdRange,
  balloonPumps,
  parseBalloonOptions,
  DEFAULT_BALLOON_OPTIONS,
} = balloon;

describe('풍선 진행 (BL-01~BL-06)', () => {
  it('BL-01: 터지는 횟수 범위는 5 ~ 인원×4+12', () => {
    expect(thresholdRange(2)).toEqual({ min: 5, max: 20 });
    expect(thresholdRange(6)).toEqual({ min: 5, max: 36 });
    expect(thresholdRange(10)).toEqual({ min: 5, max: 52 });
    expect(() => createBalloon(3, 4, 0)).toThrow();
    expect(() => createBalloon(3, 25, 0)).toThrow();
    expect(createBalloon(3, 24, 2)).toMatchObject({ turn: 2, total: 0, loser: null });
  });

  it('명세 예시: A 3번, B 2번 넘김, C 3번, A 1번 넘김, B 3번, C 2번째에 펑 (실제 14)', () => {
    let s = createBalloon(3, 14, 0);
    const play = (seat: number, n: number, end: boolean) => {
      for (let i = 0; i < n; i += 1) {
        const r = pump(s, seat);
        if (!r.ok) throw new Error(r.code);
        s = r.state;
        if (r.popped) return r;
      }
      if (end) {
        const r = endTurn(s, seat);
        if (!r.ok) throw new Error(r.code);
        s = r.state;
      }
      return null;
    };
    play(0, 3, false);
    expect([s.total, s.turn, s.turnPumps]).toEqual([3, 1, 0]);
    play(1, 2, true);
    expect([s.total, s.turn]).toEqual([5, 2]);
    play(2, 3, false);
    play(0, 1, true);
    play(1, 3, false);
    expect(s.total).toBe(12);
    const pop = play(2, 2, false);
    expect(pop?.ok && pop.popped).toBe(true);
    expect(s).toMatchObject({ total: 14, loser: 2 });
    expect(s.turns.at(-1)).toEqual({ seat: 2, pumps: 2, popped: true });
  });

  it('BL-04: 0번에서 넘기기는 INVALID_MOVE, 1번 이상이면 넘어간다', () => {
    const s = createBalloon(2, 10, 0);
    expect(endTurn(s, 0)).toEqual({ ok: false, code: 'INVALID_MOVE' });
    const a = pump(s, 0);
    if (!a.ok) throw new Error(a.code);
    const b = endTurn(a.state, 0);
    expect(b.ok && b.state.turn).toBe(1);
    expect(b.ok && b.state.turnPumps).toBe(0);
  });

  it('BL-05: 3번째를 누르고 안 터지면 자동으로 넘어간다', () => {
    let s = createBalloon(2, 20, 0);
    for (let i = 0; i < 2; i += 1) {
      const r = pump(s, 0);
      if (!r.ok) throw new Error(r.code);
      expect(r.turnEnded).toBe(false);
      s = r.state;
    }
    const third = pump(s, 0);
    expect(third.ok && third.turnEnded).toBe(true);
    expect(third.ok && third.state.turn).toBe(1);
    // 같은 사람이 4번째를 누르려 하면 차례가 아니다
    expect(third.ok && pump(third.state, 0)).toEqual({ ok: false, code: 'NOT_YOUR_TURN' });
  });

  it('BL-06: 터지는 횟수에 닿은 펌프를 누른 사람이 당첨되고, 그 뒤는 GAME_OVER', () => {
    let s = createBalloon(2, 5, 0);
    for (const seat of [0, 0, 0]) {
      const r = pump(s, seat);
      if (!r.ok) throw new Error(r.code);
      s = r.state;
    }
    expect(endTurn(s, 0)).toEqual({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(endTurn(s, 1)).toEqual({ ok: false, code: 'INVALID_MOVE' });
    for (const seat of [1, 1]) {
      const r = pump(s, seat);
      if (!r.ok) throw new Error(r.code);
      s = r.state;
    }
    expect(s.loser).toBe(1);
    expect(pump(s, 1)).toEqual({ ok: false, code: 'GAME_OVER' });
    expect(endTurn(s, 1)).toEqual({ ok: false, code: 'GAME_OVER' });
  });
});

describe('풍선 봇 (BL-12, BL-13)', () => {
  it('항상 1~3번, roll로 고르게', () => {
    expect([0, 0.33, 0.34, 0.66, 0.67, 0.999].map(balloonPumps)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('BT-06: 봇끼리 1,000판 모두 끝나고, 한 차례에 1~3번만 누르며, 당첨은 고르게 나온다', () => {
    let seed = 5;
    const roll = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296;
    };
    const players = 4;
    const losers = new Array<number>(players).fill(0);
    for (let game = 0; game < 1000; game += 1) {
      const range = thresholdRange(players);
      const threshold = range.min + Math.floor(roll() * (range.max - range.min + 1));
      let s = createBalloon(players, threshold, Math.floor(roll() * players));
      let guard = 0;
      while (s.loser === null) {
        const seat = s.turn;
        const n = balloonPumps(roll());
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(3);
        for (let i = 0; i < n && s.loser === null && s.turn === seat; i += 1) {
          const r = pump(s, seat);
          if (!r.ok) throw new Error(r.code);
          s = r.state;
        }
        if (s.loser === null && s.turn === seat) {
          const r = endTurn(s, seat);
          if (!r.ok) throw new Error(r.code);
          s = r.state;
        }
        guard += 1;
        expect(guard).toBeLessThan(200);
      }
      expect(s.total).toBe(threshold);
      losers[s.loser] = (losers[s.loser] ?? 0) + 1;
    }
    for (const n of losers) expect(n).toBeGreaterThan(150);
  });
});

describe('풍선 옵션 (4장)', () => {
  it('기본값 6명, 15초, 봇 채우기, 비공개. 2~10명, 10/15/30초만 허용', () => {
    expect(DEFAULT_BALLOON_OPTIONS).toEqual({
      maxPlayers: 6,
      turnSeconds: 15,
      fillWithBots: true,
      isPrivate: true,
    });
    expect(parseBalloonOptions({ maxPlayers: 11 })).toMatchObject({ ok: false, field: 'maxPlayers' });
    expect(parseBalloonOptions({ maxPlayers: 1 })).toMatchObject({ ok: false, field: 'maxPlayers' });
    expect(parseBalloonOptions({ maxPlayers: 10 })).toMatchObject({ ok: true });
    expect(parseBalloonOptions({ turnSeconds: 60 })).toMatchObject({ ok: false, field: 'turnSeconds' });
    expect(parseBalloonOptions({ isPrivate: 'x' })).toMatchObject({ ok: false, field: 'isPrivate' });
    expect(parseBalloonOptions({ turnSeconds: 30, foo: 1 })).toEqual({
      ok: true,
      options: { ...DEFAULT_BALLOON_OPTIONS, turnSeconds: 30 },
    });
  });
});
