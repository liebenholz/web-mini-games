import type { GameSummaryRecord } from '../../persistence/types.js';
import type { UpdownRecord } from './UpdownMatch.js';

/**
 * 업다운 한 판을 판 요약으로 바꾼다 (updown-bomb.md 11장, ADR 0002).
 * 파티 게임 공통(9장): 당첨자 = 2위, 나머지 = 1위
 */
export function toUpdownSummary(record: UpdownRecord): GameSummaryRecord {
  return {
    gameId: record.gameId,
    gameType: 'updown_bomb',
    roomCode: record.roomCode,
    options: record.options,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    endReason: record.forced ? 'forced' : 'bomb',
    summary: {
      rangeMax: record.options.rangeMax,
      bomb: record.bomb,
      moveCount: record.calls.length,
      autoMoveCount: record.calls.filter((c) => c.isAuto).length,
      botMoveCount: record.calls.filter((c) => c.isBot).length,
      forced: record.forced,
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
