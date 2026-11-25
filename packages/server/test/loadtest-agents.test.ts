import { bulls, gomoku } from '@wmg/rules';
import { describe, expect, it } from 'vitest';
import {
  decideBulls,
  decideGomoku,
  decideLiars,
  decideOneCard,
  isMyTurn,
  type BullsView,
  type GomokuView,
  type LiarsView,
  type OneCardView,
} from '../loadtest/agents.js';

const turn = { phase: 'PLAYING', currentTurn: 'me', turnId: 't1' };

describe('부하 테스트 가짜 사람 (M6)', () => {
  it('자기 차례이고 진행 중일 때만 행동한다', () => {
    expect(isMyTurn(turn, 'me')).toBe(true);
    expect(isMyTurn({ ...turn, phase: 'BIDDING' }, 'me')).toBe(true);
    expect(isMyTurn(turn, 'other')).toBe(false);
    expect(isMyTurn({ ...turn, phase: 'WAITING' }, 'me')).toBe(false);
    expect(isMyTurn({ ...turn, turnId: '' }, 'me')).toBe(false);
  });

  it('거짓말쟁이 주사위: 라운드 첫 턴은 선언, 터무니없는 선언에는 라이어 (R-06, S-11)', () => {
    const first: LiarsView = { ...turn, phase: 'BIDDING', totalDice: 10, bids: [] };
    const a = decideLiars(first, [3, 3, 4, 5, 6]);
    expect(a.type).toBe('bid');
    expect(a.payload.turnId).toBe('t1');

    const absurd: LiarsView = { ...first, bids: [{ quantity: 10, face: 2 }] };
    expect(decideLiars(absurd, [3, 3, 4, 5, 6]).type).toBe('call_liar');
  });

  it('오목: 빈 판에 둘 자리를 고르고 범위 안 좌표를 보낸다', () => {
    const view: GomokuView = {
      ...turn,
      board: gomoku.emptyBoard(),
      options: { forbidDoubleThree: true, forbidDoubleFour: true, forbidOverline: true },
    };
    const a = decideGomoku(view, 'black');
    expect(a?.type).toBe('place');
    expect(a?.payload.x).toBeGreaterThanOrEqual(0);
    expect(a?.payload.x).toBeLessThan(15);
  });

  it('원카드: 낼 수 있으면 내고, 없으면 뽑는다', () => {
    const view: OneCardView = { ...turn, topCard: 'S5', chosenSuit: '', attack: 0 };
    expect(decideOneCard(view, ['S9', 'H3'], null)).toMatchObject({ type: 'play', payload: { card: 'S9' } });
    expect(decideOneCard(view, ['H3', 'D4'], null)).toMatchObject({ type: 'draw' });
  });

  it('숫자야구: 지난 결과와 모순되지 않는 추측을 한다 (B-35)', () => {
    const view: BullsView = {
      ...turn,
      options: { digits: 3 },
      history: [
        { playerId: 'me', guess: '123', strikes: 1, balls: 0, skipped: false },
        { playerId: 'other', guess: '456', strikes: 0, balls: 0, skipped: false },
      ],
    };
    let n = 0;
    const a = decideBulls(view, 'me', 0, (k) => n++ % k);
    const guess = String(a.payload.digits);
    expect(bulls.isValidNumber(guess, 3)).toBe(true);
    expect(bulls.score(guess, '123')).toEqual({ strikes: 1, balls: 0 });
  });
});
