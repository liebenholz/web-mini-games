import type { GameSummaryRecord } from '../../persistence/types.js';
import type { BullsRecord } from './BullsMatch.js';

/**
 * 숫자야구 한 판을 판 요약으로 바꾼다 (ADR 0002, bulls-and-cows.md 10장). 비밀 숫자와 추측은 저장하지 않는다.
 * 자리 0 = 선공, 1 = 후공. 이긴 쪽 1, 진 쪽 2, 무승부면 둘 다 1
 */
export function toBullsSummary(record: BullsRecord): GameSummaryRecord {
  const players = [...record.players].sort((a, b) => a.seat - b.seat);
  return {
    gameId: record.gameId,
    gameType: 'bulls_and_cows',
    roomCode: record.roomCode,
    options: record.options,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    endReason: record.result,
    summary: {
      digits: record.options.digits,
      attempts: players.map((p) => p.attempts),
      lastChance: record.lastChance,
      skippedTurns: record.skippedTurns,
      hasBot: players.some((p) => p.isBot),
    },
    players: players.map((p) => ({
      seat: p.seat,
      guestId: p.guestId,
      nickname: p.nickname,
      isBot: p.isBot,
      finalRank: record.winnerSeat === null || record.winnerSeat === p.seat ? 1 : 2,
    })),
  };
}
