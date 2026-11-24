import { describe, expect, it } from 'vitest';
import { bulls } from '../src/index.js';

function seeded(seed: number): bulls.Pick {
  let a = seed >>> 0;
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

function ok(r: bulls.BullsResult): bulls.BullsState {
  if (!r.ok) throw new Error(r.code);
  return r.state;
}

describe('숫자야구 숫자와 판정 (B-01~B-05, B-11)', () => {
  it('BT-04 B-01: 0~9 중복 없음, 맨 앞 0 허용', () => {
    expect(bulls.isValidNumber('012', 3)).toBe(true);
    expect(bulls.isValidNumber('0123', 4)).toBe(true);
  });

  it('BT-03 B-02: 자릿수가 다름, 숫자가 아님, 중복이면 거부', () => {
    for (const v of ['112', '12', '1234', 'ab3', '1 2', 123, null, ''])
      expect(bulls.isValidNumber(v, 3), String(v)).toBe(false);
    expect(bulls.isValidNumber('123', 4)).toBe(false);
  });

  it('BT-01 B-03: 비밀 102에 345 / 120 / 152 / 102', () => {
    const r = ['345', '120', '152', '102'].map((g) => bulls.score('102', g));
    expect(r).toEqual([
      { strikes: 0, balls: 0 },
      { strikes: 1, balls: 2 },
      { strikes: 2, balls: 0 },
      { strikes: 3, balls: 0 },
    ]);
    expect(bulls.isSolved(r[3]!, 3)).toBe(true);
    expect(bulls.isSolved(r[2]!, 3)).toBe(false);
  });

  it('BT-02 B-03: 4자리 비밀 0123에 3210 / 4567 / 0123', () => {
    expect(['3210', '4567', '0123'].map((g) => bulls.score('0123', g))).toEqual([
      { strikes: 0, balls: 4 },
      { strikes: 0, balls: 0 },
      { strikes: 4, balls: 0 },
    ]);
  });

  it('B-11: 3자리는 0을 생략하고 없으면 OUT', () => {
    const f = (strikes: number, balls: number) => bulls.formatScore({ strikes, balls }, 3);
    expect([f(1, 2), f(2, 0), f(0, 3), f(0, 0), f(3, 0)]).toEqual(['1S 2B', '2S', '3B', 'OUT', '3S']);
  });

  it('B-11: 4자리는 Bull/Cow 줄임 표기, 0도 쓴다', () => {
    const f = (strikes: number, balls: number) => bulls.formatScore({ strikes, balls }, 4);
    expect([f(1, 2), f(0, 4), f(0, 0), f(4, 0)]).toEqual(['1B 2C', '0B 4C', '0B 0C', '4B 0C']);
  });

  it('가능한 숫자: 3자리 720개, 4자리 5040개, 무작위 숫자는 항상 올바르다', () => {
    expect(bulls.allNumbers(3)).toHaveLength(720);
    expect(bulls.allNumbers(4)).toHaveLength(5040);
    const pick = seeded(3);
    for (let i = 0; i < 200; i += 1) {
      expect(bulls.isValidNumber(bulls.randomNumber(3, pick), 3)).toBe(true);
      expect(bulls.isValidNumber(bulls.randomNumber(4, pick), 4)).toBe(true);
    }
  });
});

describe('진행과 승부 (B-06~B-09)', () => {
  const start = (max = 10) => bulls.startBulls(3, max, ['102', '345']);

  it('CE: 내 차례가 아니면 NOT_YOUR_TURN, 형식이 틀리면 INVALID_GUESS', () => {
    const s = start();
    expect(bulls.guessNumber(s, 1, '123')).toEqual({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(bulls.guessNumber(s, 0, '113')).toEqual({ ok: false, code: 'INVALID_GUESS' });
  });

  it('선공부터 번갈아 추측하고, 결과는 상대 비밀 숫자와 비교한다', () => {
    let s = start();
    const r = bulls.guessNumber(s, 0, '354');
    if (!r.ok) throw new Error();
    expect(r.record).toEqual({ seat: 0, guess: '354', strikes: 1, balls: 2 });
    s = r.state;
    expect(s.turn).toBe(1);
    expect(s.attempts).toEqual([1, 0]);
  });

  it('BT-06 B-07: 후공이 먼저 맞히면 바로 이긴다', () => {
    let s = ok(bulls.guessNumber(start(), 0, '789'));
    s = ok(bulls.guessNumber(s, 1, '102'));
    expect(s).toMatchObject({ over: true, result: 'solved', winner: 1, lastChance: false });
  });

  it('BT-05 B-07: 선공이 맞히면 후공에게 마지막 기회. 후공도 맞히면 무승부', () => {
    let s = ok(bulls.guessNumber(start(), 0, '345'));
    expect(s).toMatchObject({ over: false, lastChance: true, turn: 1 });
    s = ok(bulls.guessNumber(s, 1, '102'));
    expect(s).toMatchObject({ over: true, result: 'draw', winner: null });
  });

  it('BT-05 B-07: 마지막 기회에 못 맞히면 선공 승리', () => {
    let s = ok(bulls.guessNumber(start(), 0, '345'));
    s = ok(bulls.guessNumber(s, 1, '789'));
    expect(s).toMatchObject({ over: true, result: 'solved', winner: 0 });
    expect(s.attempts).toEqual([1, 1]);
  });

  it('B-07: 마지막 기회를 시간 초과로 넘겨도 선공 승리', () => {
    let s = ok(bulls.guessNumber(start(), 0, '345'));
    s = ok(bulls.skipTurn(s, 1));
    expect(s).toMatchObject({ over: true, winner: 0 });
  });

  it('BT-07 B-08: 시도 제한 10, 둘 다 10번 못 맞히면 무승부', () => {
    let s = start(10);
    for (let i = 0; i < 10; i += 1) {
      s = ok(bulls.guessNumber(s, 0, '789'));
      if (i < 9) expect(s.over).toBe(false);
      s = ok(bulls.guessNumber(s, 1, '789'));
    }
    expect(s).toMatchObject({ over: true, result: 'draw', winner: null });
    expect(s.attempts).toEqual([10, 10]);
  });

  it('B-08: 제한 없음(0)이면 계속한다', () => {
    let s = start(0);
    for (let i = 0; i < 30; i += 1) s = ok(bulls.skipTurn(ok(bulls.skipTurn(s, 0)), 1));
    expect(s.over).toBe(false);
    expect(s.attempts).toEqual([30, 30]);
  });

  it('BT-09 B-09: 넘긴 턴도 시도 1회이고 기록에 남는다', () => {
    const r = bulls.skipTurn(start(), 0);
    if (!r.ok) throw new Error();
    expect(r.record).toEqual({ seat: 0, guess: null, strikes: 0, balls: 0 });
    expect(r.state.attempts).toEqual([1, 0]);
  });

  it('끝난 판에서는 추측할 수 없다', () => {
    let s = ok(bulls.guessNumber(start(), 0, '789'));
    s = ok(bulls.guessNumber(s, 1, '102'));
    expect(bulls.guessNumber(s, 0, '123')).toEqual({ ok: false, code: 'INVALID_STATE' });
  });

  it('비밀 숫자 형식이 틀리면 시작하지 않는다', () => {
    expect(() => bulls.startBulls(3, 10, ['112', '345'])).toThrow();
  });
});

describe('방 옵션 (4장)', () => {
  it('기본값: 3자리, 10번, 30초, 봇 채우기, 비공개', () => {
    expect(bulls.parseBullsOptions(undefined)).toEqual({ ok: true, options: bulls.DEFAULT_BULLS_OPTIONS });
    expect(bulls.DEFAULT_BULLS_OPTIONS).toEqual({
      digits: 3,
      maxAttempts: 10,
      turnSeconds: 30,
      fillWithBots: true,
      isPrivate: true,
    });
  });

  it('범위 안이면 덮어쓰고, 밖이면 거부한다', () => {
    expect(bulls.parseBullsOptions({ digits: 4, maxAttempts: 0, turnSeconds: 15 })).toMatchObject({
      ok: true,
      options: { digits: 4, maxAttempts: 0, turnSeconds: 15 },
    });
    for (const [input, field] of [
      [{ digits: 5 }, 'digits'],
      [{ maxAttempts: 12 }, 'maxAttempts'],
      [{ turnSeconds: 90 }, 'turnSeconds'],
      [{ isPrivate: 1 }, 'isPrivate'],
      ['x', 'input'],
    ] as const)
      expect(bulls.parseBullsOptions(input)).toEqual({ ok: false, code: 'INVALID_OPTIONS', field });
  });
});

describe('봇 (B-35)', () => {
  it('봇은 지금까지 결과와 모순되는 추측을 하지 않는다', () => {
    const own: bulls.GuessRecord[] = [{ seat: 0, guess: '123', ...bulls.score('102', '123') }];
    for (let i = 0; i < 50; i += 1) {
      const g = bulls.botGuess(3, own, seeded(i));
      expect(bulls.score(g, '123')).toEqual(bulls.score('102', '123'));
    }
  });

  it('BT-12: 봇끼리 1,000판을 두면 모두 끝나고, 봇은 결과와 모순되는 추측을 하지 않는다', () => {
    const pick = seeded(11);
    let totalAttempts = 0;
    for (let game = 0; game < 1000; game += 1) {
      const digits: bulls.Digits = game % 4 === 0 ? 4 : 3;
      let s = bulls.startBulls(digits, game % 3 === 0 ? 0 : 10, [
        bulls.randomNumber(digits, pick),
        bulls.randomNumber(digits, pick),
      ]);
      while (!s.over) {
        const seat = s.turn;
        const own = s.history.filter((r) => r.seat === seat);
        const g = bulls.botGuess(digits, own, pick);
        for (const r of own) {
          if (r.guess === null) continue;
          const sc = bulls.score(g, r.guess);
          expect(sc).toEqual({ strikes: r.strikes, balls: r.balls });
        }
        s = ok(bulls.guessNumber(s, seat, g));
        if (s.history.length > 60) throw new Error('too long');
      }
      totalAttempts += s.attempts[0] + s.attempts[1];
    }
    // 3자리 기준 보통 5~7번에 맞힌다 (명세 4장)
    expect(totalAttempts / 2000).toBeLessThan(8);
  });
});
