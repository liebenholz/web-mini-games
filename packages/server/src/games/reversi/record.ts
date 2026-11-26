import type { GameSummaryRecord } from '../../persistence/types.js';
import type { ReversiRecord } from './ReversiMatch.js';

/**
 * 리버시 한 판을 판 요약으로 바꾼다 (reversi.md 8장, ADR 0002). 수 순서는 저장하지 않는다.
 * 자리 0 = 흑, 1 = 백. 순위는 이긴 쪽 1, 진 쪽 2, 무승부면 둘 다 1
 */
export function toReversiSummary(record: ReversiRecord): GameSummaryRecord {
  const seatOf = (color: 'black' | 'white') => (color === 'black' ? 0 : 1);
  return {
    gameId: record.gameId,
    gameType: 'reversi',
    roomCode: record.roomCode,
    options: record.options,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    endReason: record.result,
    summary: {
      result: record.result,
      winnerColor: record.winnerColor,
      black: record.black,
      white: record.white,
      moveCount: record.moves.length,
      passCount: record.passCount,
      autoMoveCount: record.moves.filter((m) => m.isAuto).length,
      botMoveCount: record.moves.filter((m) => m.isBot).length,
      hasBot: record.players.some((p) => p.isBot),
    },
    players: [...record.players]
      .sort((a, b) => seatOf(a.color) - seatOf(b.color))
      .map((p) => ({
        seat: seatOf(p.color),
        guestId: p.guestId,
        nickname: p.nickname,
        isBot: p.isBot,
        replaced: p.replaced,
        finalRank: record.winnerColor === null || record.winnerColor === p.color ? 1 : 2,
      })),
  };
}
