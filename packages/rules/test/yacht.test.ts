import { describe, expect, it } from 'vitest';
import { yacht } from '../src/index.js';

const {
  scoreCategory,
  totalOf,
  upperSum,
  bonusOf,
  ranks,
  createYacht,
  rollDice,
  scoreTurn,
  autoCategory,
  yachtBotKeep,
  yachtBotCategory,
  emptyScores,
  parseYachtOptions,
  DEFAULT_YACHT_OPTIONS,
  EMPTY,
} = yacht;

const sc = (dice: number[]) => Array.from({ length: 12 }, (_, c) => scoreCategory(dice, c));

describe('요트 점수 (YT-06, 3장 표)', () => {
  it('YA-01: 명세의 예시 표', () => {
    expect(sc([4, 4, 4, 4, 2])).toEqual([0, 2, 0, 16, 0, 0, 18, 18, 0, 0, 0, 0]);
    expect(sc([3, 3, 5, 5, 5])).toEqual([0, 0, 6, 0, 15, 0, 21, 0, 21, 0, 0, 0]);
    expect(sc([2, 3, 4, 5, 5])).toEqual([0, 2, 3, 4, 10, 0, 19, 0, 0, 15, 0, 0]);
    expect(sc([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5, 0, 15, 0, 0, 15, 30, 0]);
    expect(sc([6, 6, 6, 6, 6])).toEqual([0, 0, 0, 0, 0, 30, 30, 30, 0, 0, 0, 50]);
  });

  it('경계: 포카드 4개와 5개, 풀하우스와 요트, 스트레이트 가운데 빠짐', () => {
    expect(scoreCategory([2, 2, 2, 2, 3], yacht.CAT_FOUR)).toBe(11);
    expect(scoreCategory([2, 2, 2, 3, 3], yacht.CAT_FOUR)).toBe(0);
    expect(scoreCategory([2, 2, 2, 3, 3], yacht.CAT_FULL_HOUSE)).toBe(12);
    expect(scoreCategory([2, 2, 2, 2, 2], yacht.CAT_FULL_HOUSE)).toBe(0);
    expect(scoreCategory([1, 2, 4, 5, 6], yacht.CAT_SMALL_STRAIGHT)).toBe(0);
    expect(scoreCategory([1, 2, 3, 4, 6], yacht.CAT_SMALL_STRAIGHT)).toBe(15);
    expect(scoreCategory([3, 4, 5, 6, 6], yacht.CAT_SMALL_STRAIGHT)).toBe(15);
    expect(scoreCategory([1, 2, 3, 4, 6], yacht.CAT_LARGE_STRAIGHT)).toBe(0);
    expect(scoreCategory([2, 3, 4, 5, 6], yacht.CAT_LARGE_STRAIGHT)).toBe(30);
    expect(scoreCategory([1, 1, 1, 1, 2], yacht.CAT_YACHT)).toBe(0);
  });
});

describe('요트 보너스와 순위 (YT-07, YT-08)', () => {
  it('YA-04: 위쪽 합 62는 보너스 없음, 63은 35점', () => {
    const base = emptyScores();
    const a = [...base];
    [3, 6, 9, 12, 20, 12].forEach((v, i) => (a[i] = v)); // 62
    expect(upperSum(a)).toBe(62);
    expect(bonusOf(a)).toBe(0);
    expect(totalOf(a)).toBe(62);
    const b = [...a];
    b[5] = 13;
    expect(upperSum(b)).toBe(63);
    expect(bonusOf(b)).toBe(35);
    expect(totalOf(b)).toBe(98);
    // 아래쪽 점수는 위쪽 합에 들어가지 않는다
    b[6] = 20;
    expect(upperSum(b)).toBe(63);
    expect(totalOf(b)).toBe(118);
  });

  it('순위: 같은 점수는 같은 순위, 자기보다 높은 사람 수 + 1', () => {
    expect(ranks([201, 201, 162, 119])).toEqual([1, 1, 3, 4]);
    expect(ranks([10, 30, 20])).toEqual([3, 1, 2]);
  });
});

describe('요트 진행 (YT-02~YT-05, YT-08)', () => {
  const first = (s: ReturnType<typeof createYacht>, seat: number, fresh = [1, 2, 3, 4, 5]) => {
    const r = rollDice(s, seat, [false, false, false, false, false], fresh);
    if (!r.ok) throw new Error(r.code);
    return r.state;
  };

  it('YA-02: 첫 굴림은 모두 굴리고, 남긴 주사위는 그대로이며, 3번 뒤 굴림과 모두 남김은 INVALID_MOVE', () => {
    let s = createYacht(2, 0);
    expect(rollDice(s, 0, [true, false, false, false, false], [1, 1, 1, 1])).toEqual({
      ok: false,
      code: 'INVALID_MOVE',
    });
    expect(rollDice(s, 1, [false, false, false, false, false], [1, 2, 3, 4, 5])).toEqual({
      ok: false,
      code: 'NOT_YOUR_TURN',
    });
    s = first(s, 0);
    expect(s.dice).toEqual([1, 2, 3, 4, 5]);
    expect(s.rollNo).toBe(1);
    // 모두 남기면 굴릴 수 없다
    expect(rollDice(s, 0, [true, true, true, true, true], [])).toEqual({ ok: false, code: 'INVALID_MOVE' });
    // 새 값 개수가 안 맞으면 거부
    expect(rollDice(s, 0, [true, true, false, false, false], [6, 6])).toEqual({
      ok: false,
      code: 'INVALID_MOVE',
    });
    const r2 = rollDice(s, 0, [true, false, true, false, false], [6, 6, 6]);
    expect(r2.ok && r2.state.dice).toEqual([1, 6, 3, 6, 6]);
    if (!r2.ok) return;
    const r3 = rollDice(r2.state, 0, [false, false, false, false, false], [2, 2, 2, 2, 2]);
    expect(r3.ok && r3.state.rollNo).toBe(3);
    if (!r3.ok) return;
    expect(rollDice(r3.state, 0, [true, false, false, false, false], [1, 1, 1, 1])).toEqual({
      ok: false,
      code: 'INVALID_MOVE',
    });
  });

  it('YA-03: 굴리기 전 기록은 거부, 이미 쓴 칸은 거부, 0점 칸도 쓸 수 있다', () => {
    let s = createYacht(2, 0);
    expect(scoreTurn(s, 0, 0)).toMatchObject({ ok: false, code: 'INVALID_MOVE' });
    s = first(s, 0, [1, 2, 3, 4, 6]);
    expect(scoreTurn(s, 1, 0)).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    for (const bad of [-1, 12, 1.5, '3', null])
      expect(scoreTurn(s, 0, bad)).toMatchObject({ ok: false, code: 'INVALID_MOVE' });
    const z = scoreTurn(s, 0, yacht.CAT_YACHT);
    expect(z.ok && z.points).toBe(0);
    if (!z.ok) return;
    expect(z.state.scores[0]?.[yacht.CAT_YACHT]).toBe(0);
    expect(z.state).toMatchObject({ turn: 1, rollNo: 0, turnsDone: 1 });
    // 같은 칸은 다시 못 쓴다 (한 바퀴 돌아와서)
    let t = first(z.state, 1);
    const o = scoreTurn(t, 1, 0);
    if (!o.ok) throw new Error(o.code);
    t = first(o.state, 0);
    expect(scoreTurn(t, 0, yacht.CAT_YACHT)).toMatchObject({ ok: false, code: 'INVALID_MOVE' });
  });

  it('YA-05: 12차례씩 뒤에 끝나고, 끝난 뒤에는 GAME_OVER', () => {
    let s = createYacht(2, 1);
    for (let i = 0; i < 24; i += 1) {
      const seat = s.turn;
      s = first(s, seat, [6, 6, 6, 6, 6]);
      const cat = autoCategory(s.dice, s.scores[seat]!);
      const r = scoreTurn(s, seat, cat);
      if (!r.ok) throw new Error(`${i} ${r.code}`);
      s = r.state;
    }
    expect(yacht.isFinished(s)).toBe(true);
    expect(s.scores.every((row) => row.every((v) => v !== EMPTY))).toBe(true);
    expect(rollDice(s, s.turn, [false, false, false, false, false], [1, 2, 3, 4, 5])).toEqual({
      ok: false,
      code: 'GAME_OVER',
    });
  });
});

describe('요트 자동 기록 (YT-12)', () => {
  it('점수가 가장 높은 빈칸, 같으면 최대 점수가 낮은 칸', () => {
    expect(autoCategory([6, 6, 6, 6, 6], emptyScores())).toBe(yacht.CAT_YACHT); // 50
    // 5 5 5 1 2: 5의 눈 15가 가장 높다 (초이스 18이 더 높으니 초이스)
    expect(autoCategory([5, 5, 5, 1, 2], emptyScores())).toBe(yacht.CAT_CHOICE);
    const zeroOnly = emptyScores();
    for (let i = 0; i < 12; i += 1) zeroOnly[i] = i === 0 || i === 11 ? EMPTY : 1;
    expect(autoCategory([2, 3, 4, 6, 6], zeroOnly)).toBe(0); // 1의 눈 0점 vs 요트 0점 → 최대 점수가 낮은 1의 눈
  });
});

describe('요트 봇 (YT-13)', () => {
  it('요트가 나오면 멈추고, 가장 많은 눈을 남긴다', () => {
    expect(yachtBotKeep([4, 4, 4, 4, 4], emptyScores())).toBeNull();
    expect(yachtBotKeep([1, 2, 3, 4, 5], emptyScores())).toBeNull();
    expect(
      yachtBotKeep(
        [6, 6, 2, 3, 6],
        (() => {
          const s = emptyScores();
          s[yacht.CAT_LARGE_STRAIGHT] = 0;
          s[yacht.CAT_SMALL_STRAIGHT] = 0;
          return s;
        })(),
      ),
    ).toEqual([true, true, false, false, true]);
  });

  it('칸은 점수 − 기대 점수가 큰 곳 (요트 50점은 늘 요트 칸)', () => {
    expect(yachtBotCategory([3, 3, 3, 3, 3], emptyScores())).toBe(yacht.CAT_YACHT);
  });

  it('YA-07: 봇끼리 500판 모두 끝나고 합법 수만 두며, 평균 합계가 무작위 기록보다 높다', () => {
    let seed = 11;
    const roll = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296;
    };
    const die = () => 1 + Math.floor(roll() * 6);
    let botTotal = 0;
    let randomTotal = 0;
    for (let game = 0; game < 500; game += 1) {
      for (const smart of [true, false]) {
        let s = createYacht(2, 0);
        let guard = 0;
        while (!yacht.isFinished(s) && guard < 100) {
          const seat = s.turn;
          let st = s;
          const r1 = rollDice(st, seat, [false, false, false, false, false], Array.from({ length: 5 }, die));
          if (!r1.ok) throw new Error(r1.code);
          st = r1.state;
          for (let n = 1; n < 3; n += 1) {
            const keep = smart ? yachtBotKeep(st.dice, st.scores[seat]!) : null;
            if (!keep) break;
            const r = rollDice(st, seat, keep, Array.from({ length: keep.filter((k) => !k).length }, die));
            if (!r.ok) throw new Error(r.code);
            st = r.state;
          }
          const open = Array.from({ length: 12 }, (_, c) => c).filter((c) => st.scores[seat]![c] === EMPTY);
          const cat = smart
            ? yachtBotCategory(st.dice, st.scores[seat]!)
            : open[Math.floor(roll() * open.length)]!;
          const done = scoreTurn(st, seat, cat);
          if (!done.ok) throw new Error(done.code);
          s = done.state;
          guard += 1;
        }
        expect(yacht.isFinished(s)).toBe(true);
        const t = totalOf(s.scores[0]!);
        if (smart) botTotal += t;
        else randomTotal += t;
      }
    }
    expect(botTotal).toBeGreaterThan(randomTotal * 1.3);
  });
});

describe('요트 옵션 (4장)', () => {
  it('기본값 2명, 45초, 봇 채우기, 비공개. 2~4명, 30/45/60초만 허용', () => {
    expect(DEFAULT_YACHT_OPTIONS).toEqual({
      maxPlayers: 2,
      turnSeconds: 45,
      fillWithBots: true,
      isPrivate: true,
    });
    expect(parseYachtOptions({ maxPlayers: 5 })).toMatchObject({ ok: false, field: 'maxPlayers' });
    expect(parseYachtOptions({ maxPlayers: 1 })).toMatchObject({ ok: false, field: 'maxPlayers' });
    expect(parseYachtOptions({ maxPlayers: 4 })).toMatchObject({ ok: true });
    expect(parseYachtOptions({ turnSeconds: 15 })).toMatchObject({ ok: false, field: 'turnSeconds' });
    expect(parseYachtOptions({ isPrivate: 'x' })).toMatchObject({ ok: false, field: 'isPrivate' });
    expect(parseYachtOptions({ turnSeconds: 60, foo: 1 })).toEqual({
      ok: true,
      options: { ...DEFAULT_YACHT_OPTIONS, turnSeconds: 60 },
    });
  });
});
