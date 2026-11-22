import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROOM_OPTIONS,
  ROOM_CODE_ALPHABET,
  bestFace,
  botDecide,
  expectedCount,
  isValidBid,
  normalizeNickname,
  normalizeRoomCode,
  parseRoomOptions,
  roomCodeFromIndices,
  type DieFace,
} from '../src/index.js';

describe('S-11 botDecide', () => {
  const my: DieFace[] = [1, 4, 4, 2, 6];

  it('S-11: 기대 개수 = 내 개수(1 포함) + 남의 주사위 ÷ 3', () => {
    expect(expectedCount(my, 4, 20)).toBeCloseTo(3 + 15 / 3);
  });
  it('S-11: 가장 많이 가진 눈, 같으면 더 큰 눈 (1 제외)', () => {
    expect(bestFace(my)).toBe(4);
    expect(bestFace([1, 1, 2, 3, 5])).toBe(5);
  });
  it('S-11: 라운드 첫 턴에는 가장 많이 가진 눈으로 최소 선언 (라이어 금지, R-06)', () => {
    expect(botDecide(my, { currentBid: null, totalDice: 10 })).toEqual({
      type: 'bid',
      bid: { quantity: 1, face: 4 },
    });
  });
  it('S-11: 직전 개수가 기대 + 여유치를 넘으면 라이어', () => {
    // 기대(4) = 3 + 5/3 ≈ 4.67, 여유치 1 → 5.67 초과면 라이어
    expect(botDecide(my, { currentBid: { quantity: 6, face: 4 }, totalDice: 10 })).toEqual({ type: 'liar' });
    expect(botDecide(my, { currentBid: { quantity: 5, face: 4 }, totalDice: 10 })).toEqual({
      type: 'bid',
      bid: { quantity: 6, face: 4 },
    });
  });
  it('S-11: 더 큰 눈이면 같은 개수로 상향', () => {
    expect(botDecide(my, { currentBid: { quantity: 2, face: 3 }, totalDice: 10 })).toEqual({
      type: 'bid',
      bid: { quantity: 2, face: 4 },
    });
  });
  it('S-11: 그 눈으로 상향할 수 없으면 가장 낮은 합법 상향', () => {
    // 직전 (10, 3), 총 10개: 4로는 개수 10 유지 가능 → (10, 4)
    const d = botDecide(
      [4, 4, 4, 4, 4],
      { currentBid: { quantity: 10, face: 3 }, totalDice: 10 },
      { margin: 100 },
    );
    expect(d).toEqual({ type: 'bid', bid: { quantity: 10, face: 4 } });
    // 직전 (10, 5), 4가 최다지만 (11, 4) 불가 → (10, 6)
    const d2 = botDecide(
      [4, 4, 4, 4, 4],
      { currentBid: { quantity: 10, face: 5 }, totalDice: 10 },
      { margin: 100 },
    );
    expect(d2).toEqual({ type: 'bid', bid: { quantity: 10, face: 6 } });
  });
  it('S-11/R-11: 상향 불가면 라이어', () => {
    expect(
      botDecide([6, 6, 6, 6, 6], { currentBid: { quantity: 10, face: 6 }, totalDice: 10 }, { margin: 100 }),
    ).toEqual({
      type: 'liar',
    });
  });
  it('S-11: 봇의 선언은 항상 합법', () => {
    const faces: DieFace[] = [1, 2, 3, 4, 5, 6];
    for (let q = 1; q <= 12; q += 1) {
      for (const f of [2, 3, 4, 5, 6] as const) {
        for (const a of faces) {
          const mine: DieFace[] = [a, faces[(a + 1) % 6]!, faces[(a + 3) % 6]!];
          const d = botDecide(mine, { currentBid: { quantity: q, face: f }, totalDice: 12 });
          if (d.type === 'bid') expect(isValidBid({ quantity: q, face: f }, d.bid, 12)).toEqual({ ok: true });
        }
      }
    }
  });
});

describe('명세 4장 방 옵션', () => {
  it('기본값: 6명, 봇 채우기, 30초, 5개, 비공개', () => {
    expect(parseRoomOptions(undefined)).toEqual({ ok: true, options: DEFAULT_ROOM_OPTIONS });
    expect(DEFAULT_ROOM_OPTIONS).toEqual({
      maxPlayers: 6,
      fillWithBots: true,
      turnSeconds: 30,
      startingDice: 5,
      isPrivate: true,
    });
  });
  it('부분 입력은 기본값 위에 덮어쓴다', () => {
    const r = parseRoomOptions({
      maxPlayers: 2,
      turnSeconds: 15,
      startingDice: 3,
      fillWithBots: false,
      isPrivate: false,
      x: 1,
    });
    expect(r).toEqual({
      ok: true,
      options: { maxPlayers: 2, fillWithBots: false, turnSeconds: 15, startingDice: 3, isPrivate: false },
    });
  });
  it.each([
    [{ maxPlayers: 1 }, 'maxPlayers'],
    [{ maxPlayers: 7 }, 'maxPlayers'],
    [{ turnSeconds: 20 }, 'turnSeconds'],
    [{ startingDice: 2 }, 'startingDice'],
    [{ startingDice: 6 }, 'startingDice'],
    [{ fillWithBots: 'yes' }, 'fillWithBots'],
    [{ isPrivate: 1 }, 'isPrivate'],
    ['x', 'input'],
    [[1], 'input'],
  ])('범위 밖 값 거부 %j', (input, field) => {
    expect(parseRoomOptions(input)).toEqual({ ok: false, code: 'INVALID_OPTIONS', field });
  });
});

describe('명세 4장 방 코드', () => {
  it('영문 대문자와 숫자에서 0, O, 1, I를 뺀 32자', () => {
    expect(ROOM_CODE_ALPHABET).toHaveLength(32);
    for (const ch of '0O1I') expect(ROOM_CODE_ALPHABET).not.toContain(ch);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(32);
  });
  it('인덱스 6개로 코드를 만든다', () => {
    expect(roomCodeFromIndices([0, 1, 2, 29, 30, 31])).toBe('ABC789');
    expect(() => roomCodeFromIndices([0, 1])).toThrow(RangeError);
    expect(() => roomCodeFromIndices([0, 1, 2, 3, 4, 32])).toThrow(RangeError);
  });
  it('입력 정규화: 공백 제거, 대문자, 금지 문자 거부', () => {
    expect(normalizeRoomCode(' abc789 ')).toBe('ABC789');
    expect(normalizeRoomCode('ABC78O')).toBeNull();
    expect(normalizeRoomCode('ABC')).toBeNull();
    expect(normalizeRoomCode(42)).toBeNull();
  });
});

describe('명세 8장 닉네임', () => {
  it('2~12자 (코드 포인트 기준, 경계값)', () => {
    expect(normalizeNickname('가')).toBeNull();
    expect(normalizeNickname('가나')).toBe('가나');
    expect(normalizeNickname('가'.repeat(12))).toBe('가'.repeat(12));
    expect(normalizeNickname('가'.repeat(13))).toBeNull();
  });
  it('앞뒤 공백 제거, 연속 공백 축약, 제어 문자 거부', () => {
    expect(normalizeNickname('  주사위   왕  ')).toBe('주사위 왕');
    expect(normalizeNickname('ab\u0000c')).toBeNull();
    expect(normalizeNickname(`ab${String.fromCodePoint(0x202e)}c`)).toBeNull();
    expect(normalizeNickname(123)).toBeNull();
  });
});
