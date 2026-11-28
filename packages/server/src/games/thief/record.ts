import type { GameSummaryRecord } from '../../persistence/types.js';
import type { ThiefRecord } from './ThiefMatch.js';

/**
 * 도둑잡기 한 판을 판 요약으로 바꾼다 (thief.md 9장, ADR 0002).
 * 파티 게임 공통(updown-bomb.md 9장): 당첨자 = 2위, 나머지 = 1위
 */
export function toThiefSummary(record: ThiefRecord): GameSummaryRecord {
  return {
    gameId: record.gameId,
    gameType: 'thief',
    roomCode: record.roomCode,
    options: record.options,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    endReason: 'joker',
    summary: {
      playerCount: record.players.length,
      moveCount: record.draws,
      autoMoveCount: record.autoDraws,
      // forced: 시작할 때 이미 승부가 난 판 (첫 짝 내기만으로)
      forced: record.draws === 0,
      pairs: record.pairs,
      hasBot: record.players.some((p) => p.isBot),
      outOrder: [...record.players].sort((a, b) => a.outOrder - b.outOrder).map((p) => p.seat),
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
