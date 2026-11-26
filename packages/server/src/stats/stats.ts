import { createHash } from 'node:crypto';
import type pg from 'pg';
import {
  GAME_ID,
  GUEST_ID_PATTERN,
  kstDay,
  kstDays,
  type DailyStats,
  type StatsRange,
  type StatsResponse,
} from '@wmg/rules';
import type { GameRecord, GameRecorder, GameSummaryRecord } from '../persistence/types.js';

/**
 * 운영 통계 (docs/specs/stats.md).
 * 판 수와 참여자는 이미 저장하는 games·game_players에서 세고, 방문자만 daily_visitors에 따로 남긴다.
 */
/** CE-07: 하루 동안 같은 지문으로 묶은 클라이언트 오류 */
export interface ClientErrorRow {
  readonly day: string;
  readonly fingerprint: string;
  readonly kind: string;
  readonly game: string | null;
  readonly message: string;
  readonly release: string;
  readonly platform: string;
  readonly count: number;
}

export interface StatsStore {
  addVisit(day: string, guestHash: string): Promise<void>;
  /** CE-07: 같은 (day, fingerprint)면 개수만 더한다 */
  addClientErrors(rows: readonly ClientErrorRow[]): Promise<void>;
  /** days는 오래된 날부터. 기록이 없는 날은 0으로 채워 같은 길이로 돌려준다 */
  daily(days: readonly string[]): Promise<DailyStats[]>;
}

type Counts = {
  visitors: Map<string, number>;
  players: Map<string, number>;
  games: Map<string, Map<string, number>>;
  clientErrors: Map<string, Map<string, number>>;
};

function fill(days: readonly string[], c: Counts): DailyStats[] {
  return days.map((date) => ({
    date,
    visitors: c.visitors.get(date) ?? 0,
    players: c.players.get(date) ?? 0,
    games: Object.fromEntries(c.games.get(date) ?? []),
    clientErrors: Object.fromEntries(c.clientErrors.get(date) ?? []),
  }));
}

/** 한국 시간 하루의 시작을 timestamptz로 ($1 = 'YYYY-MM-DD') */
const FROM_KST = `($1::date::timestamp AT TIME ZONE 'Asia/Seoul')`;
const DAY_KST = `to_char((g.ended_at AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD')`;

export class PgStatsStore implements StatsStore {
  constructor(private readonly pool: pg.Pool) {}

  async addVisit(day: string, guestHash: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO daily_visitors (day, guest_hash) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [day, guestHash],
    );
  }

  async addClientErrors(rows: readonly ClientErrorRow[]): Promise<void> {
    if (rows.length === 0) return;
    const col = <K extends keyof ClientErrorRow>(k: K) => rows.map((r) => r[k]);
    await this.pool.query(
      `INSERT INTO daily_client_errors (day, fingerprint, kind, game, message, release, platform, count)
       SELECT * FROM unnest($1::date[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::int[])
       ON CONFLICT (day, fingerprint) DO UPDATE SET count = daily_client_errors.count + EXCLUDED.count`,
      [
        col('day'),
        col('fingerprint'),
        col('kind'),
        col('game'),
        col('message'),
        col('release'),
        col('platform'),
        col('count'),
      ],
    );
  }

  async daily(days: readonly string[]): Promise<DailyStats[]> {
    const from = days[0];
    if (!from) return [];
    const [games, players, visitors, errors] = await Promise.all([
      this.pool.query<{ d: string; t: string; n: number }>(
        `SELECT ${DAY_KST} AS d, g.game_type AS t, count(*)::int AS n
           FROM games g WHERE g.ended_at >= ${FROM_KST} GROUP BY 1, 2`,
        [from],
      ),
      // ST-02: 처음부터 봇인 자리는 player_id가 NULL이다. 중간에 나가 봇으로 바뀐 사람은 센다
      this.pool.query<{ d: string; n: number }>(
        `SELECT ${DAY_KST} AS d, count(DISTINCT gp.player_id)::int AS n
           FROM games g JOIN game_players gp ON gp.game_id = g.id
          WHERE g.ended_at >= ${FROM_KST} AND gp.player_id IS NOT NULL GROUP BY 1`,
        [from],
      ),
      this.pool.query<{ d: string; n: number }>(
        `SELECT to_char(day, 'YYYY-MM-DD') AS d, count(*)::int AS n
           FROM daily_visitors WHERE day >= $1::date GROUP BY 1`,
        [from],
      ),
      // CE-08: 종류별 개수만. 문구와 지문은 응답에 넣지 않는다
      this.pool.query<{ d: string; t: string; n: number }>(
        `SELECT to_char(day, 'YYYY-MM-DD') AS d, kind AS t, sum(count)::int AS n
           FROM daily_client_errors WHERE day >= $1::date GROUP BY 1, 2`,
        [from],
      ),
    ]);
    const c: Counts = { visitors: new Map(), players: new Map(), games: new Map(), clientErrors: new Map() };
    for (const r of visitors.rows) c.visitors.set(r.d, r.n);
    for (const r of players.rows) c.players.set(r.d, r.n);
    for (const [rows, target] of [
      [games.rows, c.games],
      [errors.rows, c.clientErrors],
    ] as const) {
      for (const r of rows) {
        const m = target.get(r.d) ?? new Map<string, number>();
        m.set(r.t, r.n);
        target.set(r.d, m);
      }
    }
    return fill(days, c);
  }
}

/**
 * DB 없이 돌릴 때(개발, E2E) 쓰는 메모리 통계. 판 기록을 받는 저장소 역할도 해서 끝난 판이 바로 집계된다.
 * 숫자와 해시만 두고, 판 기록 자체는 들고 있지 않는다
 */
export class MemoryStats implements StatsStore, GameRecorder {
  readonly #visitors = new Map<string, Set<string>>();
  readonly #players = new Map<string, Set<string>>();
  readonly #games = new Map<string, Map<string, number>>();
  readonly #clientErrors = new Map<string, Map<string, number>>();

  async addClientErrors(rows: readonly ClientErrorRow[]): Promise<void> {
    for (const r of rows) {
      const m = this.#clientErrors.get(r.day) ?? new Map<string, number>();
      m.set(r.kind, (m.get(r.kind) ?? 0) + r.count);
      this.#clientErrors.set(r.day, m);
    }
  }

  async addVisit(day: string, guestHash: string): Promise<void> {
    const set = this.#visitors.get(day) ?? new Set<string>();
    set.add(guestHash);
    this.#visitors.set(day, set);
  }

  async daily(days: readonly string[]): Promise<DailyStats[]> {
    const size = (m: Map<string, Set<string>>) => new Map([...m].map(([d, s]) => [d, s.size]));
    return fill(days, {
      visitors: size(this.#visitors),
      players: size(this.#players),
      games: this.#games,
      clientErrors: this.#clientErrors,
    });
  }

  #count(gameType: string, endedAt: Date, guestIds: readonly (string | null)[]): void {
    const day = kstDay(endedAt.getTime());
    const games = this.#games.get(day) ?? new Map<string, number>();
    games.set(gameType, (games.get(gameType) ?? 0) + 1);
    this.#games.set(day, games);
    const players = this.#players.get(day) ?? new Set<string>();
    for (const id of guestIds) if (id) players.add(id);
    this.#players.set(day, players);
  }

  async save(r: GameRecord): Promise<void> {
    this.#count(
      GAME_ID,
      r.endedAt,
      r.players.map((p) => p.guestId),
    );
  }

  async saveSummary(r: GameSummaryRecord): Promise<void> {
    this.#count(
      r.gameType,
      r.endedAt,
      r.players.map((p) => p.guestId),
    );
  }

  async close(): Promise<void> {}
}

/** ST-01: 게스트 ID는 그대로 두지 않고 해시만 남긴다 */
export function hashGuest(guestId: string): string {
  return createHash('sha256').update(`wmg-visit:${guestId}`).digest('hex').slice(0, 32);
}

export interface StatsServiceOptions {
  readonly now?: () => number;
  /** ST-06: 같은 기간 응답을 이만큼 재사용한다 */
  readonly cacheMs?: number;
  /** ST-05: 1초에 새로 기록하는 방문 수 상한 (DB 보호) */
  readonly maxVisitsPerSecond?: number;
  /** 하루 동안 메모리에 기억하는 방문자 수 상한 */
  readonly maxSeenPerDay?: number;
  readonly log?: (level: 'warn', message: string, extra?: Record<string, unknown>) => void;
}

export class StatsService {
  readonly #store: StatsStore;
  readonly #now: () => number;
  readonly #cacheMs: number;
  readonly #maxPerSecond: number;
  readonly #maxSeen: number;
  readonly #log: NonNullable<StatsServiceOptions['log']>;
  readonly #cache = new Map<StatsRange, { at: number; value: Promise<StatsResponse> }>();
  #seenDay = '';
  #seen = new Set<string>();
  #windowStart = 0;
  #windowCount = 0;

  constructor(store: StatsStore, options: StatsServiceOptions = {}) {
    this.#store = store;
    this.#now = options.now ?? Date.now;
    this.#cacheMs = options.cacheMs ?? 60_000;
    this.#maxPerSecond = options.maxVisitsPerSecond ?? 50;
    this.#maxSeen = options.maxSeenPerDay ?? 200_000;
    this.#log = options.log ?? (() => {});
  }

  /**
   * ST-01, ST-05: 방문 기록. 형식이 틀리면 false. 같은 날 같은 게스트는 DB에 다시 쓰지 않는다.
   * 저장이 실패해도 throw하지 않는다 (사이트 이용을 막지 않는다)
   */
  visit(guestId: unknown): boolean {
    if (typeof guestId !== 'string' || !GUEST_ID_PATTERN.test(guestId)) return false;
    const now = this.#now();
    const day = kstDay(now);
    if (day !== this.#seenDay) {
      this.#seenDay = day;
      this.#seen = new Set();
    }
    const hash = hashGuest(guestId);
    if (this.#seen.has(hash) || this.#seen.size >= this.#maxSeen) return true;
    if (now - this.#windowStart >= 1000) {
      this.#windowStart = now;
      this.#windowCount = 0;
    }
    if (this.#windowCount >= this.#maxPerSecond) return true;
    this.#windowCount += 1;
    this.#seen.add(hash);
    this.#store.addVisit(day, hash).catch((error: unknown) => {
      this.#seen.delete(hash);
      this.#log('warn', 'visit not recorded', { error: String(error) });
    });
    return true;
  }

  /** ST-03, ST-06: 기간별 일일 통계. 1분 동안은 같은 응답을 돌려준다 */
  get(range: StatsRange): Promise<StatsResponse> {
    const now = this.#now();
    const hit = this.#cache.get(range);
    if (hit && now - hit.at < this.#cacheMs) return hit.value;
    const value = this.#store.daily(kstDays(range, now)).then((days) => ({
      range,
      days,
      generatedAt: new Date(now).toISOString(),
    }));
    // 실패한 응답은 재사용하지 않는다
    value.catch(() => {
      if (this.#cache.get(range)?.value === value) this.#cache.delete(range);
    });
    this.#cache.set(range, { at: now, value });
    return value;
  }
}
