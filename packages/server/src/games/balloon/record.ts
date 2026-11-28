import type { GameSummaryRecord } from '../../persistence/types.js';
import type { BalloonRecord } from './BalloonMatch.js';

/**
 * 풍선 한 판을 판 요약으로 바꾼다 (balloon.md 10장, ADR 0002).
 * 파티 게임 공통(updown-bomb.md 9장): 당첨자 = 2위, 나머지 = 1위
 */
export function toBalloonSummary(record: BalloonRecord): GameSummaryRecord {
  return {
    gameId: record.gameId,
    gameType: 'balloon',
    roomCode: record.roomCode,
    options: record.options,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    endReason: 'pop',
    summary: {
      playerCount: record.players.length,
      threshold: record.threshold,
      totalPumps: record.threshold,
      moveCount: record.turns.length,
      autoMoveCount: record.turns.filter((t) => t.isAuto).length,
      botMoveCount: record.turns.filter((t) => t.isBot).length,
      hasBot: record.players.some((p) => p.isBot),
    },
    players: [...record.players]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        seat: p.seat,
        guestId: p.guestId,
        nickname: p.nickname,
        isBot: p.isBot,
        replaced: p.replaced,
        finalRank: p.seat === record.loserSeat ? 2 : 1,
      })),
  };
}
