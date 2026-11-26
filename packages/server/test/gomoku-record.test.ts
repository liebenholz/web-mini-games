import { gomoku } from '@wmg/rules';
import { describe, expect, it } from 'vitest';
import type { GomokuRecord } from '../src/games/gomoku/GomokuMatch.js';
import { toGomokuSummary } from '../src/games/gomoku/record.js';

function record(patch: Partial<GomokuRecord> = {}): GomokuRecord {
  return {
    gameId: '00000000-0000-4000-8000-000000000001',
    roomCode: 'ABCDEF',
    startedAt: new Date(1000),
    endedAt: new Date(61000),
    options: gomoku.DEFAULT_GOMOKU_OPTIONS,
    players: [
      {
        playerId: 'p-w',
        guestId: 'guest-w',
        nickname: '백돌',
        color: 'white',
        isBot: false,
        replaced: false,
      },
      { playerId: 'p-b', guestId: null, nickname: '봇', color: 'black', isBot: true, replaced: false },
    ],
    moves: [
      { color: 'black', x: 7, y: 7, isBot: true },
      { color: 'white', x: 8, y: 8, isBot: false },
      { color: 'black', x: 6, y: 6, isBot: true },
    ],
    result: 'timeout',
    winnerColor: 'black',
    ...patch,
  };
}

describe('오목 판 요약 (ADR 0002)', () => {
  it('자리 0은 흑, 1은 백이고 이긴 쪽이 1위다', () => {
    const s = toGomokuSummary(record());
    expect(s.gameType).toBe('gomoku');
    expect(s.endReason).toBe('timeout');
    expect(s.players.map((p) => [p.seat, p.nickname, p.isBot, p.finalRank])).toEqual([
      [0, '봇', true, 1],
      [1, '백돌', false, 2],
    ]);
    expect(s.summary).toEqual({
      result: 'timeout',
      winnerColor: 'black',
      moveCount: 3,
      botMoveCount: 2,
      hasBot: true,
    });
  });

  it('무승부면 둘 다 1위이고, 수 좌표는 넣지 않는다', () => {
    const s = toGomokuSummary(record({ result: 'draw', winnerColor: null }));
    expect(s.players.map((p) => p.finalRank)).toEqual([1, 1]);
    expect(JSON.stringify(s)).not.toContain('"x"');
  });
});
