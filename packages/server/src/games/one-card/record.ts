import type { GameSummaryRecord } from '../../persistence/types.js';
import type { OneCardRecord } from './OneCardMatch.js';

/** 원카드 한 판을 판 요약으로 바꾼다 (ADR 0002, one-card.md 13장). 패와 낸 카드 순서는 저장하지 않는다 */
export function toOneCardSummary(record: OneCardRecord): GameSummaryRecord {
  return {
    gameId: record.gameId,
    gameType: 'one_card',
    roomCode: record.roomCode,
    options: record.options,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    endReason: 'completed',
    summary: {
      turnCount: record.turnCount,
      bankruptCount: record.players.filter((p) => p.bankrupt).length,
      maxAttack: record.maxAttack,
      penaltyCount: record.penaltyCount,
      hasBot: record.players.some((p) => p.isBot),
    },
    players: [...record.players]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        seat: p.seat,
        guestId: p.guestId,
        nickname: p.nickname,
        isBot: p.isBot,
        finalRank: p.rank,
      })),
  };
}
