import { describe, expect, it } from 'vitest';
import { updown } from '../src/index.js';

const {
  callNumber,
  createUpdown,
  isInRange,
  parseUpdownOptions,
  remaining,
  updownPick,
  DEFAULT_UPDOWN_OPTIONS,
} = updown;

const R100 = { low: 1, high: 100 };

describe('업다운 진행 (UD-01~UD-07)', () => {
  it('UD-01: 폭탄은 범위 안이어야 하고, 시작 범위와 첫 차례를 그대로 쓴다', () => {
    const s = createUpdown(R100, 3, 42, 1);
    expect(s).toMatchObject({ low: 1, high: 100, turn: 1, loser: null, forced: false, calls: [] });
    expect(() => createUpdown(R100, 3, 0, 0)).toThrow();
    expect(() => createUpdown(R100, 3, 101, 0)).toThrow();
    expect(() => createUpdown(R100, 1, 5, 0)).toThrow();
  });

  it('명세 예시: 50 다운, 20 업, 40 업, 45 다운, 42 폭탄 → B 당첨', () => {
    let s = createUpdown(R100, 3, 42, 0);
    const steps: [number, number, string, number, number][] = [
      [0, 50, 'down', 1, 49],
      [1, 20, 'up', 21, 49],
      [2, 40, 'up', 41, 49],
      [0, 45, 'down', 41, 44],
    ];
    for (const [seat, value, result, low, high] of steps) {
      const r = callNumber(s, seat, value);
      expect(r.ok && r.result).toBe(result);
      if (!r.ok) return;
      s = r.state;
      expect([s.low, s.high]).toEqual([low, high]);
    }
    const end = callNumber(s, 1, 42);
    expect(end.ok && end.result).toBe('bomb');
    if (end.ok) expect(end.state).toMatchObject({ loser: 1, forced: false });
  });

  it('UD-02: 차례는 좌석 순서로 돈다', () => {
    let s = createUpdown(R100, 3, 99, 2);
    for (const expected of [0, 1, 2, 0]) {
      const r = callNumber(s, s.turn, s.low);
      if (!r.ok) throw new Error(r.code);
      s = r.state;
      expect(s.turn).toBe(expected);
    }
  });

  it('UD-03: 범위 밖, 소수, 문자, 다른 사람 차례는 거부하고 상태 그대로', () => {
    const s = createUpdown({ low: 1, high: 50 }, 2, 10, 0);
    for (const v of [0, 51, 2.5, '10', null, Number.NaN])
      expect(callNumber(s, 0, v)).toEqual({ ok: false, code: 'OUT_OF_RANGE' });
    expect(callNumber(s, 1, 10)).toEqual({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(s).toMatchObject({ low: 1, high: 50, calls: [] });
    expect(isInRange(s, 1)).toBe(true);
    expect(isInRange(s, 50)).toBe(true);
  });

  it('UD-04, UD-05: 경계값. 낮은 끝을 말하면 낮은 값이 1 오르고, 높은 끝이면 1 내린다', () => {
    const s = createUpdown({ low: 1, high: 10 }, 2, 5, 0);
    const up = callNumber(s, 0, 1);
    expect(up.ok && [up.state.low, up.state.high]).toEqual([2, 10]);
    const down = callNumber(s, 0, 10);
    expect(down.ok && [down.state.low, down.state.high]).toEqual([1, 9]);
  });

  it('UT-05 (UD-07): 숫자가 하나만 남으면 다음 차례인 사람이 바로 당첨 (forced)', () => {
    // 범위 4~6, 폭탄 5. 좌석 0이 4 → 5~6, 좌석 1이 6 → 5만 남음 → 좌석 0 당첨
    let s = createUpdown({ low: 4, high: 6 }, 3, 5, 0);
    const a = callNumber(s, 0, 4);
    if (!a.ok) throw new Error(a.code);
    s = a.state;
    expect(s.loser).toBeNull();
    const b = callNumber(s, 1, 6);
    if (!b.ok) throw new Error(b.code);
    expect(b.result).toBe('down');
    expect(b.state).toMatchObject({ low: 5, high: 5, loser: 2, forced: true });
    expect(callNumber(b.state, 2, 5)).toEqual({ ok: false, code: 'GAME_OVER' });
  });

  it('remaining: 남은 숫자 수', () => {
    expect(remaining({ low: 41, high: 44 })).toBe(4);
  });
});

describe('업다운 봇 (UD-12, UD-13)', () => {
  it('항상 범위 안, roll로 고르게 고른다', () => {
    expect(updownPick({ low: 41, high: 44 }, 0)).toBe(41);
    expect(updownPick({ low: 41, high: 44 }, 0.999)).toBe(44);
    expect(updownPick({ low: 41, high: 44 }, 0.5)).toBe(43);
    expect(updownPick({ low: 7, high: 7 }, 0.9)).toBe(7);
  });

  it('UT-08: 봇끼리 1,000판 모두 끝나고, 늘 범위 안의 숫자만 말한다', () => {
    let seed = 3;
    const roll = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296;
    };
    let forced = 0;
    const losers = new Array<number>(4).fill(0);
    for (let game = 0; game < 1000; game += 1) {
      const range = { low: 1, high: [50, 100, 200][game % 3] ?? 100 };
      const bomb = updownPick(range, roll());
      let s = createUpdown(range, 4, bomb, Math.floor(roll() * 4));
      let guard = 0;
      while (s.loser === null) {
        const v = updownPick(s, roll());
        expect(isInRange(s, v)).toBe(true);
        const r = callNumber(s, s.turn, v);
        if (!r.ok) throw new Error(r.code);
        s = r.state;
        guard += 1;
        expect(guard).toBeLessThanOrEqual(range.high);
      }
      if (s.forced) forced += 1;
      losers[s.loser] = (losers[s.loser] ?? 0) + 1;
    }
    expect(forced).toBeGreaterThan(0);
    // 자리마다 고르게 당첨된다 (각 250 ± 여유)
    for (const n of losers) expect(n).toBeGreaterThan(150);
  });
});

describe('업다운 옵션 (4장)', () => {
  it('기본값: 1~100, 6명, 15초, 봇 채우기, 비공개', () => {
    expect(DEFAULT_UPDOWN_OPTIONS).toEqual({
      rangeMax: 100,
      maxPlayers: 6,
      turnSeconds: 15,
      fillWithBots: true,
      isPrivate: true,
    });
  });

  it('범위 밖 값은 거부하고 모르는 키는 무시한다', () => {
    expect(parseUpdownOptions({ rangeMax: 150 })).toMatchObject({ ok: false, field: 'rangeMax' });
    expect(parseUpdownOptions({ turnSeconds: 60 })).toMatchObject({ ok: false, field: 'turnSeconds' });
    expect(parseUpdownOptions({ maxPlayers: 11 })).toMatchObject({ ok: false, field: 'maxPlayers' });
    expect(parseUpdownOptions({ maxPlayers: 10 })).toMatchObject({ ok: true });
    expect(parseUpdownOptions({ maxPlayers: 1 })).toMatchObject({ ok: false, field: 'maxPlayers' });
    expect(parseUpdownOptions({ isPrivate: 'no' })).toMatchObject({ ok: false, field: 'isPrivate' });
    expect(parseUpdownOptions({ rangeMax: 50, turnSeconds: 10, maxPlayers: 3, foo: 1 })).toEqual({
      ok: true,
      options: { ...DEFAULT_UPDOWN_OPTIONS, rangeMax: 50, turnSeconds: 10, maxPlayers: 3 },
    });
  });
});
