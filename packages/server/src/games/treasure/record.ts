import type { GameSummaryRecord } from '../../persistence/types.js';
import type { TreasureRecord } from './TreasureMatch.js';

/**
 * 보물 찾기 한 판을 판 요약으로 바꾼다 (treasure.md 10장, ADR 0002).
 * 파티 게임 공통(updown-bomb.md 9장): 당첨자 = 2위, 나머지 = 1위
 */
export function toTreasureSummary(record: TreasureRecord): GameSummaryRecord {
  return {
    gameId: record.gameId,
    gameType: 'treasure',
    roomCode: record.roomCode,
    options: record.options,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    endReason: record.tieBreak ? 'tie_break' : 'farthest',
    summary: {
      playerCount: record.players.length,
      // moveCount: 재대결 횟수 (평균 재대결)
      moveCount: record.replays,
      rounds: record.replays + 1,
      lastMaxDistSq: record.lastMaxSq,
      autoMoveCount: record.autoPicks,
      // forced: 동점이 한 번이라도 나온 판
      forced: record.replays > 0,
      tieBreak: record.tieBreak,
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
