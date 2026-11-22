import { describe, expect, it } from 'vitest';
import {
  aliveSeats,
  applyLoss,
  canCallLiar,
  countFace,
  createTable,
  findPlayer,
  isEliminated,
  isGameOver,
  isHigherBid,
  isValidBid,
  minimumQuantityForFace,
  minimumRaise,
  nextStarter,
  nextTurnSeat,
  ranking,
  resolveLiar,
  totalDice,
  type Bid,
  type DieFace,
  type PlayerDice,
  type TableState,
} from '../src/index.js';

const bid = (quantity: number, face: Bid['face']): Bid => ({ quantity, face });

describe('R-01 구성', () => {
  it('R-01: 각 좌석이 시작 주사위 수만큼 갖는다 (기본 5)', () => {
    const t = createTable([0, 1, 2], 5);
    expect(t.players.map((p) => p.diceCount)).toEqual([5, 5, 5]);
    expect(totalDice(t)).toBe(15);
  });
  it('R-01: 시작 주사위는 3~5만 허용 (경계값)', () => {
    expect(() => createTable([0, 1], 2)).toThrow(RangeError);
    expect(() => createTable([0, 1], 6)).toThrow(RangeError);
    expect(() => createTable([0, 1], 3.5)).toThrow(RangeError);
    expect(totalDice(createTable([0, 1], 3))).toBe(6);
  });
  it('R-01: 같은 좌석 두 번은 거부', () => {
    expect(() => createTable([0, 0], 5)).toThrow(RangeError);
  });
});

describe('R-02 좌석과 턴 순서', () => {
  it('R-02: 좌석 번호 오름차순으로 정렬된다', () => {
    expect(createTable([2, 0, 1], 5).players.map((p) => p.seat)).toEqual([0, 1, 2]);
  });
  it('R-02: 시계 방향 다음 생존자, 끝에서 처음으로 순환', () => {
    expect(nextTurnSeat(0, [0, 1, 2])).toBe(1);
    expect(nextTurnSeat(2, [0, 1, 2])).toBe(0);
    expect(nextTurnSeat(1, [0, 2, 4])).toBe(2);
    expect(nextTurnSeat(4, [0, 2, 4])).toBe(0);
  });
  it('R-02: 생존자가 없으면 예외', () => {
    expect(() => nextTurnSeat(0, [])).toThrow(RangeError);
  });
});

describe('R-03 첫 라운드 선', () => {
  it('R-03: 무작위 선정은 서버 책임. 룰 엔진은 어떤 생존 좌석이든 선으로 받아 다음 차례를 계산한다', () => {
    for (const starter of [0, 1, 2]) {
      expect([0, 1, 2]).toContain(nextTurnSeat(starter, [0, 1, 2]));
    }
  });
});

describe('R-04 이후 라운드 선', () => {
  it('R-04: 주사위를 잃은 사람이 생존해 있으면 그 사람이 선', () => {
    expect(nextStarter(1, [0, 1, 2])).toBe(1);
  });
  it('R-04: 탈락했으면 시계 방향 다음 생존자', () => {
    expect(nextStarter(1, [0, 2])).toBe(2);
    expect(nextStarter(2, [0, 1])).toBe(0);
  });
});

describe('R-05 선언 형식', () => {
  it('R-05/E-03: 눈은 2~6만 가능', () => {
    expect(isValidBid(null, { quantity: 1, face: 1 }, 10)).toEqual({
      ok: false,
      code: 'INVALID_BID',
      reason: 'FACE_OUT_OF_RANGE',
    });
    expect(isValidBid(null, { quantity: 1, face: 7 }, 10)).toMatchObject({
      ok: false,
      reason: 'FACE_OUT_OF_RANGE',
    });
    expect(isValidBid(null, { quantity: 1, face: 2 }, 10)).toEqual({ ok: true });
    expect(isValidBid(null, { quantity: 1, face: 6 }, 10)).toEqual({ ok: true });
  });
  it('R-05/E-02: 개수는 1 이상, 총 주사위 수 이하 (경계값)', () => {
    expect(isValidBid(null, { quantity: 0, face: 3 }, 10)).toMatchObject({
      ok: false,
      reason: 'QUANTITY_OUT_OF_RANGE',
    });
    expect(isValidBid(null, { quantity: 10, face: 3 }, 10)).toEqual({ ok: true });
    expect(isValidBid(null, { quantity: 11, face: 3 }, 10)).toMatchObject({
      ok: false,
      reason: 'QUANTITY_OUT_OF_RANGE',
    });
  });
  it('R-05: 정수가 아닌 값이나 잘못된 타입은 거부', () => {
    expect(isValidBid(null, { quantity: 1.5, face: 3 }, 10)).toMatchObject({
      ok: false,
      reason: 'NOT_INTEGER',
    });
    expect(isValidBid(null, { quantity: '2', face: 3 }, 10)).toMatchObject({
      ok: false,
      reason: 'NOT_INTEGER',
    });
    expect(isValidBid(null, { quantity: 2, face: null }, 10)).toMatchObject({
      ok: false,
      reason: 'NOT_INTEGER',
    });
    expect(isValidBid(null, { quantity: Number.NaN, face: 3 }, 10)).toMatchObject({
      ok: false,
      reason: 'NOT_INTEGER',
    });
  });
});

describe('R-06 첫 선언', () => {
  it('R-06/TC-06: 직전 선언이 없으면 라이어 불가 (NO_BID_TO_CALL)', () => {
    expect(canCallLiar(null)).toEqual({ ok: false, code: 'NO_BID_TO_CALL' });
  });
  it('R-06: 첫 선언은 어떤 합법 선언이든 가능', () => {
    expect(isValidBid(null, { quantity: 1, face: 2 }, 2)).toEqual({ ok: true });
  });
});

describe('R-07 상향 규칙', () => {
  it('R-07/TC-01: 같은 개수에 더 낮은 눈은 거부', () => {
    expect(isValidBid(bid(4, 3), bid(4, 2), 15)).toEqual({
      ok: false,
      code: 'INVALID_BID',
      reason: 'NOT_HIGHER',
    });
  });
  it('R-07/TC-02: 개수가 늘면 눈은 자유', () => {
    expect(isValidBid(bid(4, 3), bid(5, 2), 15)).toEqual({ ok: true });
  });
  it('R-07/E-01: 같은 개수, 같은 눈은 거부', () => {
    expect(isValidBid(bid(4, 3), bid(4, 3), 15)).toMatchObject({ ok: false, reason: 'NOT_HIGHER' });
  });
  it('R-07: 같은 개수면 더 높은 눈만 허용', () => {
    expect(isValidBid(bid(4, 3), bid(4, 4), 15)).toEqual({ ok: true });
    expect(isHigherBid(bid(4, 3), bid(4, 6))).toBe(true);
  });
  it('R-07: 개수가 줄면 눈이 높아도 거부', () => {
    expect(isValidBid(bid(4, 3), bid(3, 6), 15)).toMatchObject({ ok: false, reason: 'NOT_HIGHER' });
  });
});

describe('R-08 라이어', () => {
  it('R-08: 직전 선언이 있으면 라이어 가능 (차례 검사는 서버)', () => {
    expect(canCallLiar(bid(1, 2))).toEqual({ ok: true });
  });
});

describe('R-09 1 와일드', () => {
  it('R-09: 1은 선언된 눈으로 함께 센다', () => {
    const dice: DieFace[][] = [
      [1, 3, 5],
      [3, 3, 1],
    ];
    expect(countFace(dice, 3)).toBe(5);
    expect(countFace(dice, 5)).toBe(3);
    expect(countFace(dice, 6)).toBe(2);
  });
  it('R-09: 와일드를 끄면 1을 세지 않는다', () => {
    expect(countFace([[1, 3, 3]], 3, { onesWild: false })).toBe(2);
  });
  it('R-09: PlayerDice 형식도 받는다', () => {
    expect(countFace([{ seat: 0, dice: [1, 1, 2] }], 4)).toBe(2);
  });
});

describe('R-10 판정', () => {
  // TC-03, TC-04: 3이 4개, 1이 2개 → 3으로 세는 주사위 6개
  const dice: PlayerDice[] = [
    { seat: 0, dice: [3, 3, 1, 5, 6] },
    { seat: 1, dice: [3, 3, 1, 2, 4] },
  ];
  it('R-10/TC-03: 실제 = 선언이면 선언 성공, 라이어를 외친 사람이 잃는다', () => {
    const r = resolveLiar(bid(6, 3), dice, 0, 1);
    expect(r).toMatchObject({ actual: 6, bidSucceeded: true, loserSeat: 1 });
  });
  it('R-10/TC-04: 실제 < 선언이면 선언자가 잃는다', () => {
    const r = resolveLiar(bid(7, 3), dice, 0, 1);
    expect(r).toMatchObject({ actual: 6, bidSucceeded: false, loserSeat: 0 });
  });
  it('R-10: 실제 > 선언이어도 선언 성공', () => {
    expect(resolveLiar(bid(5, 3), dice, 1, 0)).toMatchObject({ bidSucceeded: true, loserSeat: 0 });
  });
});

describe('R-11 상향 불가', () => {
  it('R-11/TC-05: 직전이 (총 주사위 수, 6)이면 어떤 선언도 불가', () => {
    const prev = bid(10, 6);
    expect(isValidBid(prev, bid(11, 6), 10)).toMatchObject({ ok: false, code: 'INVALID_BID' });
    expect(isValidBid(prev, bid(11, 2), 10)).toMatchObject({ ok: false, code: 'INVALID_BID' });
    expect(isValidBid(prev, bid(10, 6), 10)).toMatchObject({ ok: false, code: 'INVALID_BID' });
    expect(minimumRaise(prev, 10)).toBeNull();
    expect(canCallLiar(prev)).toEqual({ ok: true });
  });
  it('R-11: (총 주사위 수, 5)면 6으로만 상향 가능', () => {
    expect(minimumRaise(bid(10, 5), 10)).toEqual(bid(10, 6));
  });
});

describe('R-12 탈락', () => {
  it('R-12: 주사위가 0개가 되면 탈락하고 탈락 순서를 기록한다', () => {
    let t = createTable([0, 1, 2], 3);
    t = applyLoss(applyLoss(applyLoss(t, 1), 1), 1);
    const p1 = findPlayer(t, 1);
    expect(p1 && isEliminated(p1)).toBe(true);
    expect(p1?.eliminationOrder).toBe(1);
    expect(aliveSeats(t)).toEqual([0, 2]);
    expect(totalDice(t)).toBe(6);
  });
  it('R-12: applyLoss는 원본을 바꾸지 않는다', () => {
    const t = createTable([0, 1], 3);
    applyLoss(t, 0);
    expect(findPlayer(t, 0)?.diceCount).toBe(3);
  });
  it('R-12: 이미 탈락했거나 없는 좌석은 예외', () => {
    let t = createTable([0, 1], 3);
    for (let i = 0; i < 3; i += 1) t = applyLoss(t, 0);
    expect(() => applyLoss(t, 0)).toThrow(RangeError);
    expect(() => applyLoss(t, 9)).toThrow(RangeError);
  });
  it('R-12/TC-07: 1개 남은 플레이어가 지면 탈락, 시계 방향 다음 생존자가 선', () => {
    let t: TableState = createTable([0, 1, 2], 3);
    t = applyLoss(applyLoss(t, 1), 1); // seat 1: 1개 남음
    t = applyLoss(t, 1); // 패배 → 탈락
    expect(isEliminated(findPlayer(t, 1)!)).toBe(true);
    expect(nextStarter(1, aliveSeats(t))).toBe(2);
  });
});

describe('R-13 승리와 순위', () => {
  it('R-13: 마지막 생존자 1위, 나중에 탈락할수록 높은 순위', () => {
    let t = createTable([0, 1, 2, 3], 3);
    const eliminate = (s: TableState, seat: number) => applyLoss(applyLoss(applyLoss(s, seat), seat), seat);
    t = eliminate(t, 2); // 1번째 탈락 → 4위
    expect(isGameOver(t)).toBe(false);
    expect(ranking(t).find((r) => r.seat === 0)?.rank).toBeNull();
    t = eliminate(t, 0); // 2번째 → 3위
    t = eliminate(t, 3); // 3번째 → 2위
    expect(isGameOver(t)).toBe(true);
    expect(ranking(t)).toEqual([
      { seat: 1, rank: 1 },
      { seat: 3, rank: 2 },
      { seat: 0, rank: 3 },
      { seat: 2, rank: 4 },
    ]);
  });
});

describe('S-06 minimumRaise', () => {
  it('S-06: 직전 선언이 없으면 2가 1개', () => {
    expect(minimumRaise(null, 10)).toEqual(bid(1, 2));
    expect(minimumRaise(null, 0)).toBeNull();
  });
  it('S-06/TC-10: 직전 4가 3개 → 5가 3개', () => {
    expect(minimumRaise(bid(3, 4), 10)).toEqual(bid(3, 5));
  });
  it('S-06: 눈이 6이면 개수 +1, 눈 2', () => {
    expect(minimumRaise(bid(3, 6), 10)).toEqual(bid(4, 2));
  });
  it('minimumQuantityForFace: 눈별 최소 개수', () => {
    expect(minimumQuantityForFace(null, 4, 10)).toBe(1);
    expect(minimumQuantityForFace(bid(3, 4), 5, 10)).toBe(3);
    expect(minimumQuantityForFace(bid(3, 4), 4, 10)).toBe(4);
    expect(minimumQuantityForFace(bid(10, 4), 3, 10)).toBeNull();
  });
});

describe('명세 2장 예시 라운드 (3인, 총 15개)', () => {
  it('A "3이 6개"에 B가 라이어 → 선언 성공, B가 1개 잃고 다음 선은 B', () => {
    const A = 0;
    const B = 1;
    const C = 2;
    const dice: PlayerDice[] = [
      { seat: A, dice: [1, 2, 3, 3, 5] },
      { seat: B, dice: [2, 3, 4, 6, 6] },
      { seat: C, dice: [1, 3, 5, 5, 6] },
    ];
    let table = createTable([A, B, C], 5);
    const total = totalDice(table);
    expect(total).toBe(15);

    const sequence: Array<[number, Bid]> = [
      [A, bid(4, 3)],
      [B, bid(5, 3)],
      [C, bid(5, 5)],
      [A, bid(6, 3)],
    ];
    let prev: Bid | null = null;
    let turn = A;
    for (const [seat, next] of sequence) {
      expect(seat).toBe(turn);
      expect(isValidBid(prev, next, total)).toEqual({ ok: true });
      prev = next;
      turn = nextTurnSeat(turn, aliveSeats(table));
    }
    expect(turn).toBe(B);
    expect(canCallLiar(prev)).toEqual({ ok: true });

    const result = resolveLiar(prev!, dice, A, B);
    expect(result).toMatchObject({ actual: 6, bidSucceeded: true, loserSeat: B });
    table = applyLoss(table, result.loserSeat);
    expect(findPlayer(table, B)?.diceCount).toBe(4);
    expect(nextStarter(result.loserSeat, aliveSeats(table))).toBe(B);
  });
});
