import pg from 'pg';
import { MIGRATIONS } from './migrations.js';
import type { GamePlayerRecord, GameRecord, GameRecorder, GameSummaryRecord } from './types.js';

type Log = (level: 'info' | 'warn' | 'error', message: string, extra?: Record<string, unknown>) => void;

export interface PgRecorderOptions {
  readonly connectionString: string;
  readonly log: Log;
  /** 재시도 간격(ms). 길이만큼 재시도한다 */
  readonly retryDelaysMs?: readonly number[];
}

const DEFAULT_RETRY_DELAYS = [1_000, 5_000, 30_000, 120_000, 600_000];

export async function migrate(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    // 여러 프로세스가 동시에 시작해도 한 번만 적용되도록 잠근다
    await client.query('SELECT pg_advisory_lock(72_001)');
    const done = new Set(
      (await client.query<{ id: string }>('SELECT id FROM schema_migrations')).rows.map((r) => r.id),
    );
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
        await client.query('COMMIT');
        applied.push(m.id);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(72_001)').catch(() => {});
    client.release();
  }
  return applied;
}

/** 판 하나를 한 트랜잭션으로 저장한다 (M3). */
export async function writeGame(client: pg.PoolClient, r: GameRecord): Promise<void> {
  await client.query('BEGIN');
  try {
    await upsertPlayers(client, r.players);
    await client.query(
      `INSERT INTO games (id, room_code, options, started_at, ended_at, end_reason)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [r.gameId, r.roomCode, JSON.stringify(r.options), r.startedAt, r.endedAt, r.endReason],
    );
    for (const p of r.players) {
      await client.query(
        `INSERT INTO game_players (game_id, seat, player_id, nickname, is_bot, final_rank)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [r.gameId, p.seat, p.guestId, p.nickname, p.isBot, p.finalRank],
      );
    }
    for (const round of r.rounds) {
      await client.query(
        `INSERT INTO rounds (game_id, round_no, starter_seat, dice, result) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [
          r.gameId,
          round.roundNo,
          round.starterSeat,
          JSON.stringify(round.dice),
          JSON.stringify(round.result),
        ],
      );
    }
    if (r.bids.length > 0) {
      // 선언은 한 번에 넣는다 (unnest)
      await client.query(
        `INSERT INTO bids (game_id, round_no, seq, seat, quantity, face, is_auto, created_at)
         SELECT $1, * FROM unnest($2::smallint[], $3::int[], $4::smallint[], $5::smallint[], $6::smallint[], $7::boolean[], $8::timestamptz[])
         ON CONFLICT DO NOTHING`,
        [
          r.gameId,
          r.bids.map((b) => b.roundNo),
          r.bids.map((b) => b.seq),
          r.bids.map((b) => b.seat),
          r.bids.map((b) => b.quantity),
          r.bids.map((b) => b.face),
          r.bids.map((b) => b.isAuto),
          r.bids.map((b) => b.createdAt),
        ],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function upsertPlayers(client: pg.PoolClient, players: readonly GamePlayerRecord[]): Promise<void> {
  for (const p of players) {
    if (!p.guestId) continue;
    await client.query(
      `INSERT INTO players (id, nickname) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname, last_seen_at = now()`,
      [p.guestId, p.nickname],
    );
  }
}

/** 판 요약 하나를 한 트랜잭션으로 저장한다: games 한 줄 + game_players (ADR 0002) */
export async function writeSummary(client: pg.PoolClient, r: GameSummaryRecord): Promise<void> {
  await client.query('BEGIN');
  try {
    await upsertPlayers(client, r.players);
    await client.query(
      `INSERT INTO games (id, room_code, options, started_at, ended_at, end_reason, game_type, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [
        r.gameId,
        r.roomCode,
        JSON.stringify(r.options),
        r.startedAt,
        r.endedAt,
        r.endReason,
        r.gameType,
        JSON.stringify(r.summary),
      ],
    );
    for (const p of r.players) {
      await client.query(
        `INSERT INTO game_players (game_id, seat, player_id, nickname, is_bot, final_rank)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [r.gameId, p.seat, p.guestId, p.nickname, p.isBot, p.finalRank],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

/**
 * PostgreSQL 저장소. save()는 절대 throw하지 않는다: 실패하면 로그를 남기고 백그라운드에서 재시도한다.
 * 모든 재시도가 실패하면 기록 전체를 error 로그로 남겨 수동 복구할 수 있게 한다.
 */
export class PgRecorder implements GameRecorder {
  readonly pool: pg.Pool;
  readonly #log: Log;
  readonly #delays: readonly number[];
  #timers = new Set<NodeJS.Timeout>();
  #closed = false;

  constructor(options: PgRecorderOptions) {
    this.pool = new pg.Pool({
      connectionString: options.connectionString,
      max: 4,
      idleTimeoutMillis: 30_000,
    });
    this.pool.on('error', (error) => options.log('warn', 'pg pool error', { error: String(error) }));
    this.#log = options.log;
    this.#delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS;
  }

  async save(record: GameRecord): Promise<void> {
    await this.#attempt(record, (client) => writeGame(client, record), 0);
  }

  async saveSummary(record: GameSummaryRecord): Promise<void> {
    await this.#attempt(record, (client) => writeSummary(client, record), 0);
  }

  async #attempt(
    record: GameRecord | GameSummaryRecord,
    write: (client: pg.PoolClient) => Promise<void>,
    attempt: number,
  ): Promise<void> {
    if (this.#closed) return;
    try {
      const client = await this.pool.connect();
      try {
        await write(client);
      } finally {
        client.release();
      }
      if (attempt > 0) this.#log('info', 'game record saved after retry', { gameId: record.gameId, attempt });
    } catch (error) {
      const delay = this.#delays[attempt];
      if (delay === undefined) {
        this.#log('error', 'game record dropped after retries', {
          gameId: record.gameId,
          record,
          error: String(error),
        });
        return;
      }
      this.#log('warn', 'game record save failed, retrying', {
        gameId: record.gameId,
        attempt,
        delay,
        error: String(error),
      });
      const timer = setTimeout(() => {
        this.#timers.delete(timer);
        void this.#attempt(record, write, attempt + 1);
      }, delay);
      timer.unref();
      this.#timers.add(timer);
    }
  }

  get pendingRetries(): number {
    return this.#timers.size;
  }

  async close(): Promise<void> {
    this.#closed = true;
    for (const t of this.#timers) clearTimeout(t);
    this.#timers.clear();
    await this.pool.end();
  }
}
