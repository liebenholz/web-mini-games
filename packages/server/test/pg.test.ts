import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { migrate, PgRecorder } from '../src/persistence/pgRecorder.js';
import { replayGame } from '../src/persistence/replay.js';
import { startHumans } from './helpers.js';

/** TEST_DATABASE_URL이 있을 때만 실행한다 (CI의 postgres 서비스 또는 로컬 docker) */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('M3: PostgreSQL 저장', () => {
  const pool = new pg.Pool({ connectionString: url });
  afterAll(async () => pool.end());

  it('한 판이 끝나면 5개 테이블에 기록이 남고, 저장된 값으로 재현된다', async () => {
    await pool.query(
      'DROP TABLE IF EXISTS bids, rounds, game_players, games, players, schema_migrations CASCADE',
    );
    expect(await migrate(pool)).toEqual(['001_init']);
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
