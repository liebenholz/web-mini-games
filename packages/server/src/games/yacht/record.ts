import { yacht } from '@wmg/rules';
import type { GameSummaryRecord } from '../../persistence/types.js';
import type { YachtRecord } from './YachtMatch.js';

/**
 * 요트 한 판을 판 요약으로 바꾼다 (yacht.md 10장, ADR 0002).
 * 순위는 합계가 더 높은 사람 수 + 1이다. 같은 점수는 같은 순위(YT-08)
 */
export function toYachtSummary(record: YachtRecord): GameSummaryRecord {
  const seats = [...record.players].sort((a, b) => a.seat - b.seat);
  const totals = seats.map((p) => p.total);
  const rank = yacht.ranks(totals);
  return {
    gameId: record.gameId,
    gameType: 'yacht',
    roomCode: record.roomCode,
    options: record.options,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    endReason: 'completed',
    summary: {
      playerCount: seats.length,
      totals,
      bonusCount: seats.filter((p) => p.bonus > 0).length,
      yachts: seats.reduce((n, p) => n + (p.scores[yacht.CAT_YACHT] === 50 ? 1 : 0), 0),
      moveCount: record.turns,
      autoMoveCount: record.autoTurns,
      // forced: 보너스를 받은 사람이 있는 판 (보너스 비율)
      forced: seats.some((p) => p.bonus > 0),
      hasBot: seats.some((p) => p.isBot),
    },
    players: seats.map((p, i) => ({
      seat: p.seat,
      guestId: p.guestId,
      nickname: p.nickname,
      isBot: p.isBot,
      replaced: p.replaced,
      finalRank: rank[i] ?? 1,
    })),
  };
}
