import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { migrate, PgRecorder } from '../src/persistence/pgRecorder.js';
import { replayGame } from '../src/persistence/replay.js';
import { gomoku } from '@wmg/rules';
import { toGomokuSummary } from '../src/games/gomoku/record.js';
import { startHumans } from './helpers.js';
import { PgStatsStore } from '../src/stats/stats.js';

/** TEST_DATABASE_URL이 있을 때만 실행한다 (CI의 postgres 서비스 또는 로컬 docker) */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('M3: PostgreSQL 저장', () => {
  const pool = new pg.Pool({ connectionString: url });
  afterAll(async () => pool.end());

  it('한 판이 끝나면 5개 테이블에 기록이 남고, 저장된 값으로 재현된다', async () => {
    await pool.query(
      'DROP TABLE IF EXISTS daily_abandoned, daily_client_errors, daily_visitors, bids, rounds, game_players, games, players, schema_migrations CASCADE',
    );
    expect(await migrate(pool)).toEqual([
      '001_init',
      '002_game_type_summary',
      '003_daily_visitors',
      '004_daily_client_errors',
      '005_game_metrics',
    ]);
    expect(await migrate(pool)).toEqual([]);

    const { scheduler, io } = startHumans(3, { startingDice: 3 }, 11);
    scheduler.runAll();
    const record = io.records[0]!;
    const recorder = new PgRecorder({ connectionString: url!, log: () => {} });
    await recorder.save(record);
    await recorder.close();

    const count = async (table: string) =>
      Number(
        (
          await pool.query(
            `SELECT count(*) FROM ${table} WHERE ${table === 'players' ? 'true' : 'game_id = $1'}`,
            table === 'players' ? [] : [record.gameId],
          )
        ).rows[0].count,
      );
    expect(
      Number((await pool.query('SELECT count(*) FROM games WHERE id = $1', [record.gameId])).rows[0].count),
    ).toBe(1);
    expect(await count('players')).toBe(3);
    expect(await count('game_players')).toBe(3);
    expect(await count('rounds')).toBe(record.rounds.length);
    expect(await count('bids')).toBe(record.bids.length);

    const rounds = await pool.query(
      'SELECT round_no, starter_seat, dice, result FROM rounds WHERE game_id = $1',
      [record.gameId],
    );
    const bids = await pool.query(
      'SELECT round_no, seq, seat, quantity, face, is_auto, created_at FROM bids WHERE game_id = $1',
      [record.gameId],
    );
    const players = await pool.query('SELECT seat, final_rank FROM game_players WHERE game_id = $1', [
      record.gameId,
    ]);
    const replay = replayGame({
      startingDice: 3,
      players: players.rows.map((p) => ({ seat: p.seat, finalRank: p.final_rank })),
      rounds: rounds.rows.map((r) => ({
        roundNo: r.round_no,
        starterSeat: r.starter_seat,
        dice: r.dice,
        result: r.result,
      })),
      bids: bids.rows.map((b) => ({
        roundNo: b.round_no,
        seq: b.seq,
        seat: b.seat,
        quantity: b.quantity,
        face: b.face,
        isAuto: b.is_auto,
        createdAt: b.created_at,
      })),
    });
    expect(replay.problems).toEqual([]);
  });

  it('ADR 0002: 기존 판은 liars_dice, 오목은 판 요약 한 줄과 참가자 2명이 남는다', async () => {
    const types = await pool.query('SELECT DISTINCT game_type FROM games');
    expect(types.rows.map((r) => r.game_type)).toEqual(['liars_dice']);

    const summary = toGomokuSummary({
      gameId: '00000000-0000-4000-8000-0000000000aa',
      roomCode: 'GMKABC',
      startedAt: new Date('2026-11-24T00:00:00Z'),
      endedAt: new Date('2026-11-24T00:05:00Z'),
      options: gomoku.DEFAULT_GOMOKU_OPTIONS,
      players: [
        {
          playerId: 'a',
          guestId: 'guest-gomoku-black',
          nickname: '흑돌',
          color: 'black',
          isBot: false,
          replaced: true,
        },
        { playerId: 'b', guestId: null, nickname: '봇', color: 'white', isBot: true, replaced: false },
      ],
      moves: [{ color: 'black', x: 7, y: 7, isBot: false }],
      result: 'five',
      winnerColor: 'black',
    });
    const recorder = new PgRecorder({ connectionString: url!, log: () => {} });
    await recorder.saveSummary(summary);
    await recorder.saveSummary(summary); // 재시도로 두 번 와도 한 줄
    await recorder.close();

    const game = await pool.query('SELECT game_type, end_reason, summary, options FROM games WHERE id = $1', [
      summary.gameId,
    ]);
    expect(game.rows).toHaveLength(1);
    expect(game.rows[0].game_type).toBe('gomoku');
    expect(game.rows[0].end_reason).toBe('five');
    expect(game.rows[0].summary).toMatchObject({ result: 'five', moveCount: 1, hasBot: true });
    expect(game.rows[0].options).toMatchObject({
      forbidDoubleThree: true,
      forbidDoubleFour: true,
      forbidOverline: true,
    });
    const seats = await pool.query(
      'SELECT seat, player_id, is_bot, final_rank, replaced FROM game_players WHERE game_id = $1 ORDER BY seat',
      [summary.gameId],
    );
    expect(seats.rows).toEqual([
      { seat: 0, player_id: 'guest-gomoku-black', is_bot: false, final_rank: 1, replaced: true },
      { seat: 1, player_id: null, is_bot: true, final_rank: 2, replaced: false },
    ]);
  });

  it('ST-01, ST-02, ST-04: 한국 시간 날짜로 판 수·참여자·방문자를 센다', async () => {
    const store = new PgStatsStore(pool);
    // 2026-11-24 00:05Z = 한국 시간 11-24 09:05 (위 오목 판). 같은 게스트가 두 번 와도 방문자 1명
    await store.addVisit('2026-11-24', 'hash-a');
    await store.addVisit('2026-11-24', 'hash-a');
    await store.addVisit('2026-11-24', 'hash-b');
    const [day23, day24] = await store.daily(['2026-11-23', '2026-11-24']);
    expect(day23).toEqual({ date: '2026-11-23', visitors: 0, players: 0, games: {}, clientErrors: {} });
    expect(day24).toEqual({
      date: '2026-11-24',
      visitors: 2,
      players: 1,
      games: { gomoku: 1 },
      clientErrors: {},
    });
  });

  it('CE-07, CE-08: 같은 지문은 개수만 더하고, 일일 통계에는 종류별 합계만 나온다', async () => {
    const store = new PgStatsStore(pool);
    const row = {
      day: '2026-11-24',
      fingerprint: 'fp-a',
      kind: 'js_error',
      game: 'gomoku',
      message: 'boom',
      release: 'abc1234',
      platform: 'ios',
      count: 2,
    };
    await store.addClientErrors([row, { ...row, fingerprint: 'fp-b', kind: 'reconnect_failed', count: 1 }]);
    await store.addClientErrors([{ ...row, count: 3, release: 'later' }]);
    const saved = await pool.query(
      "SELECT count, release FROM daily_client_errors WHERE fingerprint = 'fp-a'",
    );
    expect(saved.rows).toEqual([{ count: 5, release: 'abc1234' }]);
    const [day24] = await store.daily(['2026-11-24']);
    expect(day24?.clientErrors).toEqual({ js_error: 5, reconnect_failed: 1 });
    expect(JSON.stringify(day24)).not.toContain('boom');
  });

  it('ST-08~ST-10: 게임별 합계를 SQL로 센다 (이탈, 봇, 모두 나간 판, 수)', async () => {
    const recorder = new PgRecorder({ connectionString: url!, log: () => {} });
    await recorder.abandoned('gomoku', new Date('2026-11-24T01:00:00Z'));
    await recorder.abandoned('gomoku', new Date('2026-11-24T02:00:00Z'));
    await recorder.close();
    const raw = await new PgStatsStore(pool).gameMetrics('2026-11-24');
    expect(raw.find((r) => r.gameType === 'gomoku')).toMatchObject({
      games: 1,
      minutesSum: 5,
      replacedGames: 1,
      botGames: 1,
      movesSum: 1,
      abandoned: 2,
    });
  });
});

describe('M3: DB 장애', () => {
  it('DB에 연결할 수 없으면 save는 throw하지 않고 재시도를 예약한다', async () => {
    const logs: string[] = [];
    const recorder = new PgRecorder({
      connectionString: 'postgres://nobody@127.0.0.1:1/none',
      log: (_l, m) => logs.push(m),
      retryDelaysMs: [60_000],
    });
    const { scheduler, io } = startHumans(2, { startingDice: 3 }, 12);
    scheduler.runAll();
    await expect(recorder.save(io.records[0]!)).resolves.toBeUndefined();
    expect(recorder.pendingRetries).toBe(1);
    expect(logs).toContain('game record save failed, retrying');
    await recorder.close();
  });
});
