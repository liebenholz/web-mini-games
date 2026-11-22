import { describe, expect, it } from 'vitest';
import { withSubject } from '../src/josa.js';
import type { BidView, PlayerView, RevealView } from '../src/net.js';
import { describeReveal, summarizeReveal } from '../src/revealSummary.js';

function player(id: string, seat: number, diceCount: number, nickname = id): PlayerView {
  return {
    id,
    nickname,
    seat,
    isBot: false,
    isHost: false,
    ready: true,
    connected: true,
    autopilot: false,
    spectator: false,
    diceCount,
    eliminated: false,
    rank: 0,
  };
}

// 실제 플레이 화면에서 확인한 판: 봇 1이 "4가 9개", 봇 2가 라이어, 실제 13개
const players = [
  player('me', 0, 4, '나나'),
  player('b1', 1, 5, '봇 1'),
  player('b2', 2, 5, '봇 2'),
  player('b3', 3, 4, '봇 3'),
  player('b4', 4, 5, '봇 4'),
  player('b5', 5, 5, '봇 5'),
];
const reveal: RevealView = {
  roomId: 'X',
  roundNo: 7,
  seq: 1,
  bid: { quantity: 9, face: 4 },
  actual: 13,
  bidSucceeded: true,
  loserId: 'b2',
  dice: [
    { playerId: 'me', seat: 0, dice: [4, 4, 2, 4] },
    { playerId: 'b1', seat: 1, dice: [5, 4, 2, 1, 4] },
    { playerId: 'b2', seat: 2, dice: [6, 3, 3, 3, 2] },
    { playerId: 'b3', seat: 3, dice: [5, 4, 1, 4] },
    { playerId: 'b4', seat: 4, dice: [3, 4, 6, 6, 5] },
    { playerId: 'b5', seat: 5, dice: [4, 4, 1, 3, 3] },
  ],
} as RevealView;
const bids: BidView[] = [{ playerId: 'b1', quantity: 9, face: 4, isAuto: false }];

describe('공개 판정 요약', () => {
  it('R-09: 선언 눈과 와일드 1을 나눠 센다 (10 + 3 = 13)', () => {
    const s = summarizeReveal(reveal, players, bids);
    expect(s).toMatchObject({ faceCount: 10, wildCount: 3, actual: 13, succeeded: true });
    expect(s.faceCount + s.wildCount).toBe(s.actual);
  });

  it('R-08, R-10: 선언자는 마지막 선언, 라이어는 바로 다음 생존자, 성공이면 라이어가 잃는다', () => {
    const s = summarizeReveal(reveal, players, bids);
    expect(s).toMatchObject({ bidderId: 'b1', callerId: 'b2', loserId: 'b2' });
  });

  it('R-04: 다음 선은 주사위를 잃은 사람', () => {
    expect(summarizeReveal(reveal, players, bids).nextStarterId).toBe('b2');
  });

  it('R-04, R-12: 마지막 주사위를 잃으면 탈락, 다음 선은 시계 방향 다음 생존자', () => {
    const lastDie = players.map((p) => (p.id === 'b2' ? { ...p, diceCount: 1 } : p));
    const s = summarizeReveal(reveal, lastDie, bids);
    expect(s.loserEliminated).toBe(true);
    expect(s.nextStarterId).toBe('b3');
  });

  it('이번 판정으로 한 명만 남으면 다음 선이 없다', () => {
    const two = {
      ...reveal,
      bidSucceeded: false,
      loserId: 'a',
      dice: [
        { playerId: 'a', seat: 0, dice: [2] },
        { playerId: 'b', seat: 1, dice: [3, 3] },
      ],
    } as RevealView;
    const s = summarizeReveal(
      two,
      [player('a', 0, 1), player('b', 1, 2)],
      [{ playerId: 'a', quantity: 2, face: 5, isAuto: false }],
    );
    expect(s).toMatchObject({ bidderId: 'a', callerId: 'b', loserEliminated: true, nextStarterId: null });
  });

  it('선언 기록이 없어도(재접속) 패배자와 판정으로 선언자를 되짚는다', () => {
    expect(summarizeReveal(reveal, players, [])).toMatchObject({ bidderId: 'b1', callerId: 'b2' });
    const failed = { ...reveal, bidSucceeded: false, loserId: 'b1' } as RevealView;
    expect(summarizeReveal(failed, players, [])).toMatchObject({ bidderId: 'b1', callerId: 'b2' });
  });

  it('문장: 이름과 조사, 나는 "나/내"로 부른다', () => {
    const t = describeReveal(summarizeReveal(reveal, players, bids), players, 'me');
    expect(t).toEqual({
      bidderPart: '봇 1의 선언',
      callerPart: '봇 2가 라이어!',
      bidPart: '4가 9개 이상',
      verdict: '선언 성공',
      reason: '13개 ≥ 선언 9개라서 선언이 맞았어요.',
      loss: '봇 2가 주사위를 잃어요',
      next: '다음 선은 봇 2',
    });
    const mine = describeReveal(
      { ...summarizeReveal(reveal, players, bids), bidderId: 'me', loserId: 'me', nextStarterId: 'me' },
      players,
      'me',
    );
    expect(mine).toMatchObject({ bidderPart: '내 선언', loss: '내가 주사위를 잃어요', next: '다음 선은 나' });
  });

  it('캔버스용으로 긴 이름을 줄인다', () => {
    const long = players.map((p) => (p.id === 'b1' ? { ...p, nickname: '아주긴닉네임열두글자' } : p));
    const t = describeReveal(summarizeReveal(reveal, long, bids), long, 'me', 6);
    expect(t.bidderPart).toBe('아주긴닉네임…의 선언');
  });
});

describe('조사 이/가', () => {
  it.each([
    ['민준', '민준이'],
    ['하나', '하나가'],
    ['봇 2', '봇 2가'],
    ['봇 3', '봇 3이'],
    ['봇 1', '봇 1이'],
    ['4', '4가'],
    ['6', '6이'],
    ['Tom', 'Tom이'],
    ['Jake', 'Jake가'],
    ['🎲', '🎲이(가)'],
  ])('%s → %s', (word, expected) => {
    expect(withSubject(word)).toBe(expected);
  });
});
