import { describe, expect, it } from 'vitest';
import type { GameSummaryRecord } from '../src/persistence/types.js';
import { emptyRaw, finalizeMetrics, MemoryStats, StatsService } from '../src/stats/stats.js';

const at = '2026-11-26T03:00:00Z'; // 한국 시간 11-26 12:00

function summary(gameType: string, patch: Partial<GameSummaryRecord> = {}): GameSummaryRecord {
  return {
    gameId: crypto.randomUUID(),
    gameType,
    roomCode: 'ABCDEF',
    options: {},
    startedAt: new Date(Date.parse(at) - 6 * 60_000),
    endedAt: new Date(at),
    endReason: 'five',
    summary: {},
    players: [
      { guestId: 'guest-aaaaaaaa', nickname: 'a', seat: 0, isBot: false, replaced: false, finalRank: 1 },
      { guestId: 'guest-bbbbbbbb', nickname: 'b', seat: 1, isBot: false, replaced: false, finalRank: 2 },
    ],
    ...patch,
  };
}

describe('게임별 진행 지표 (docs/specs/stats.md ST-08~ST-12)', () => {
  it('ST-11: 판이 5판 미만이면 비율은 null, 평균은 보낸다', () => {
    const m = finalizeMetrics({
      ...emptyRaw('gomoku'),
      games: 4,
      minutesSum: 20,
      timeouts: 2,
      movesSum: 120,
    });
    expect(m).toMatchObject({ games: 4, avgMinutes: 5, replacedRate: null, botRate: null });
    expect(m.extra).toEqual({ timeoutRate: null, avgMoves: 30 });
  });

  it('ST-10: 게임마다 고유 지표를 만든다', () => {
    expect(
      finalizeMetrics({ ...emptyRaw('bulls_and_cows'), games: 5, draws: 1, attemptsSum: 60, attemptsN: 10 })
        .extra,
    ).toEqual({
      avgAttempts: 6,
      drawRate: 0.2,
    });
    expect(
      finalizeMetrics({ ...emptyRaw('one_card'), games: 10, bankruptGames: 3, turnsSum: 400 }).extra,
    ).toEqual({
      bankruptRate: 0.3,
      avgTurns: 40,
    });
    expect(finalizeMetrics({ ...emptyRaw('liars_dice'), games: 5, bids: 40, autoBids: 4 }).extra).toEqual({
      autoBidRate: 0.1,
    });
    expect(
      finalizeMetrics({ ...emptyRaw('reversi'), games: 5, movesSum: 300, passGames: 2, autoMoves: 15 }).extra,
    ).toEqual({ avgMoves: 60, passRate: 0.4, autoMoveRate: 0.05 });
    expect(
      finalizeMetrics({ ...emptyRaw('updown_bomb'), games: 10, movesSum: 70, autoMoves: 7, forcedGames: 2 })
        .extra,
    ).toEqual({ avgMoves: 7, autoMoveRate: 0.1, forcedRate: 0.2 });
    expect(finalizeMetrics({ ...emptyRaw('balloon'), games: 5, movesSum: 60, autoMoves: 3 }).extra).toEqual({
      avgTurns: 12,
      autoTurnRate: 0.05,
    });
    expect(
      finalizeMetrics({ ...emptyRaw('treasure'), games: 10, movesSum: 5, autoMoves: 15, forcedGames: 3 })
        .extra,
    ).toEqual({ avgReplays: 0.5, avgAutoPicks: 1.5, tieRate: 0.3 });
  });

  it('ST-08~ST-10: 메모리 저장소로 끝난 판, 이탈, 봇, 모두 나간 판을 센다', async () => {
    const memory = new MemoryStats();
    for (let i = 0; i < 4; i += 1)
      await memory.saveSummary(summary('gomoku', { summary: { moveCount: 40 } }));
    await memory.saveSummary(
      summary('gomoku', {
        endReason: 'timeout',
        summary: { moveCount: 20 },
        players: [
          { guestId: 'guest-aaaaaaaa', nickname: 'a', seat: 0, isBot: false, replaced: true, finalRank: 2 },
          { guestId: null, nickname: '봇', seat: 1, isBot: true, replaced: false, finalRank: 1 },
        ],
      }),
    );
    await memory.abandoned('gomoku', new Date(at));
    await memory.abandoned('one_card', new Date(at));

    const s = new StatsService(memory, { now: () => Date.parse(at), cacheMs: 0 });
    const res = await s.get(7);
    expect(res.perGame.map((g) => g.gameType)).toEqual(['gomoku', 'one_card']);
    expect(res.perGame[0]).toMatchObject({
      games: 5,
      avgMinutes: 6,
      replacedRate: 0.2,
      botRate: 0.2,
      abandoned: 1,
      extra: { timeoutRate: 0.2, avgMoves: 36 },
    });
    expect(res.perGame[1]).toMatchObject({ games: 0, abandoned: 1, avgMinutes: null });
    expect(JSON.stringify(res.perGame)).not.toContain('guest-');
  });
});
