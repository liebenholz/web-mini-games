import { createHash } from 'node:crypto';
import type pg from 'pg';
import {
  GAME_ID,
  GUEST_ID_PATTERN,
  kstDay,
  kstDays,
  MIN_GAMES_FOR_RATE,
  type DailyStats,
  type GameMetrics,
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
  /** ST-10: fromDay(한국 시간)부터 끝난 판의 게임별 합계 */
  gameMetrics(fromDay: string): Promise<RawGameMetrics[]>;
}

/** ST-10: 게임별 합계. 비율과 평균은 finalizeMetrics가 만든다 */
export interface RawGameMetrics {
  readonly gameType: string;
  readonly games: number;
  readonly minutesSum: number;
  readonly replacedGames: number;
  readonly botGames: number;
  readonly timeouts: number;
  readonly draws: number;
  readonly movesSum: number;
  readonly attemptsSum: number;
  /** 숫자야구는 한 판에 두 사람의 시도가 있다 */
  readonly attemptsN: number;
  readonly turnsSum: number;
  readonly bankruptGames: number;
  /** 리버시: 넘김이 한 번이라도 나온 판 */
  readonly passGames: number;
  /** 리버시: 시간 초과로 서버가 대신 둔 수 (RV-12) */
  readonly autoMoves: number;
  readonly bids: number;
  readonly autoBids: number;
  readonly abandoned: number;
}

export function emptyRaw(gameType: string): RawGameMetrics {
  return {
    gameType,
    games: 0,
    minutesSum: 0,
    replacedGames: 0,
    botGames: 0,
    timeouts: 0,
    draws: 0,
    movesSum: 0,
    attemptsSum: 0,
    attemptsN: 0,
    turnsSum: 0,
    bankruptGames: 0,
    passGames: 0,
    autoMoves: 0,
    bids: 0,
    autoBids: 0,
    abandoned: 0,
  };
}

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

/** ST-10, ST-11: 판이 5판 미만이면 비율은 null. 평균은 판이 하나라도 있으면 보낸다 */
export function finalizeMetrics(raw: RawGameMetrics): GameMetrics {
  const n = raw.games;
  const rate = (k: number) => (n >= MIN_GAMES_FOR_RATE ? round(k / n, 3) : null);
  const avg = (sum: number, count: number) => (count > 0 ? round(sum / count, 1) : null);
  const extra: Record<string, number | null> = {};
  switch (raw.gameType) {
    case 'gomoku':
      extra.timeoutRate = rate(raw.timeouts);
      extra.avgMoves = avg(raw.movesSum, n);
      break;
    case 'bulls_and_cows':
      extra.avgAttempts = avg(raw.attemptsSum, raw.attemptsN);
      extra.drawRate = rate(raw.draws);
      break;
    case 'one_card':
      extra.bankruptRate = rate(raw.bankruptGames);
      extra.avgTurns = avg(raw.turnsSum, n);
      break;
    case 'reversi':
      extra.avgMoves = avg(raw.movesSum, n);
      extra.passRate = rate(raw.passGames);
      extra.autoMoveRate =
        n >= MIN_GAMES_FOR_RATE && raw.movesSum > 0 ? round(raw.autoMoves / raw.movesSum, 3) : null;
      break;
    case GAME_ID:
      extra.autoBidRate = n >= MIN_GAMES_FOR_RATE && raw.bids > 0 ? round(raw.autoBids / raw.bids, 3) : null;
      break;
  }
  return {
    gameType: raw.gameType,
    games: n,
    // 짧은 판(숫자야구 몇십 초)도 초로 보일 수 있게 소수 둘째 자리까지
    avgMinutes: n > 0 ? round(raw.minutesSum / n, 2) : null,
    replacedRate: rate(raw.replacedGames),
    abandoned: raw.abandoned,
    botRate: rate(raw.botGames),
    extra,
  };
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

  async gameMetrics(fromDay: string): Promise<RawGameMetrics[]> {
    const num = (v: unknown) => Number(v ?? 0);
    const [games, bids, abandoned] = await Promise.all([
      this.pool.query<Record<string, unknown>>(
        `SELECT g.game_type AS t,
                count(*) AS games,
                coalesce(sum(extract(epoch FROM g.ended_at - g.started_at) / 60), 0) AS minutes,
                count(*) FILTER (WHERE EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id = g.id AND gp.replaced)) AS replaced,
                count(*) FILTER (WHERE EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id = g.id AND gp.is_bot)) AS bots,
                count(*) FILTER (WHERE g.end_reason = 'timeout') AS timeouts,
                count(*) FILTER (WHERE g.end_reason = 'draw') AS draws,
                coalesce(sum((g.summary->>'moveCount')::numeric), 0) AS moves,
                coalesce(sum((g.summary->'attempts'->>0)::numeric + (g.summary->'attempts'->>1)::numeric), 0) AS attempts,
                count(*) FILTER (WHERE g.summary ? 'attempts') * 2 AS attempts_n,
                coalesce(sum((g.summary->>'turnCount')::numeric), 0) AS turns,
                count(*) FILTER (WHERE (g.summary->>'bankruptCount')::int > 0) AS bankrupt,
                count(*) FILTER (WHERE (g.summary->>'passCount')::int > 0) AS passes,
                coalesce(sum((g.summary->>'autoMoveCount')::numeric), 0) AS auto_moves
           FROM games g WHERE g.ended_at >= ${FROM_KST} GROUP BY 1`,
        [fromDay],
      ),
      this.pool.query<{ t: string; n: string; auto: string }>(
        `SELECT g.game_type AS t, count(*) AS n, count(*) FILTER (WHERE b.is_auto) AS auto
           FROM bids b JOIN games g ON g.id = b.game_id
          WHERE g.ended_at >= ${FROM_KST} GROUP BY 1`,
        [fromDay],
      ),
      this.pool.query<{ t: string; n: string }>(
        `SELECT game_type AS t, sum(count) AS n FROM daily_abandoned WHERE day >= $1::date GROUP BY 1`,
        [fromDay],
      ),
    ]);
    const out = new Map<string, RawGameMetrics>();
    const get = (t: string) => out.get(t) ?? emptyRaw(t);
    for (const r of games.rows) {
      const t = String(r.t);
      out.set(t, {
        ...get(t),
        games: num(r.games),
        minutesSum: num(r.minutes),
        replacedGames: num(r.replaced),
        botGames: num(r.bots),
        timeouts: num(r.timeouts),
        draws: num(r.draws),
        movesSum: num(r.moves),
        attemptsSum: num(r.attempts),
        attemptsN: num(r.attempts_n),
        turnsSum: num(r.turns),
        bankruptGames: num(r.bankrupt),
        passGames: num(r.passes),
        autoMoves: num(r.auto_moves),
      });
    }
    for (const r of bids.rows) out.set(r.t, { ...get(r.t), bids: num(r.n), autoBids: num(r.auto) });
    for (const r of abandoned.rows) out.set(r.t, { ...get(r.t), abandoned: num(r.n) });
    return [...out.values()];
  }

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
  /** ST-10: 날짜 → 게임 → 합계 */
  readonly #metrics = new Map<string, Map<string, RawGameMetrics>>();
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

  #addMetrics(day: string, gameType: string, patch: (m: RawGameMetrics) => RawGameMetrics): void {
    const byGame = this.#metrics.get(day) ?? new Map<string, RawGameMetrics>();
    byGame.set(gameType, patch(byGame.get(gameType) ?? emptyRaw(gameType)));
    this.#metrics.set(day, byGame);
  }

  #recordMetrics(
    gameType: string,
    r: { startedAt: Date; endedAt: Date; endReason: string; players: GameRecord['players'] },
    summary: Record<string, unknown>,
    bids: readonly { isAuto: boolean }[],
  ): void {
    const num = (v: unknown) => (typeof v === 'number' ? v : 0);
    const attempts = Array.isArray(summary.attempts) ? summary.attempts.map(num) : [];
    this.#addMetrics(kstDay(r.endedAt.getTime()), gameType, (m) => ({
      ...m,
      games: m.games + 1,
      minutesSum: m.minutesSum + (r.endedAt.getTime() - r.startedAt.getTime()) / 60_000,
      replacedGames: m.replacedGames + (r.players.some((p) => p.replaced) ? 1 : 0),
      botGames: m.botGames + (r.players.some((p) => p.isBot) ? 1 : 0),
      timeouts: m.timeouts + (r.endReason === 'timeout' ? 1 : 0),
      draws: m.draws + (r.endReason === 'draw' ? 1 : 0),
      movesSum: m.movesSum + num(summary.moveCount),
      attemptsSum: m.attemptsSum + attempts.reduce((a, b) => a + b, 0),
      attemptsN: m.attemptsN + attempts.length,
      turnsSum: m.turnsSum + num(summary.turnCount),
      bankruptGames: m.bankruptGames + (num(summary.bankruptCount) > 0 ? 1 : 0),
      passGames: m.passGames + (num(summary.passCount) > 0 ? 1 : 0),
      autoMoves: m.autoMoves + num(summary.autoMoveCount),
      bids: m.bids + bids.length,
      autoBids: m.autoBids + bids.filter((b) => b.isAuto).length,
    }));
  }

  async gameMetrics(fromDay: string): Promise<RawGameMetrics[]> {
    const out = new Map<string, RawGameMetrics>();
    for (const [day, byGame] of this.#metrics) {
      if (day < fromDay) continue;
      for (const [t, m] of byGame) {
        const prev = out.get(t) ?? emptyRaw(t);
        const sum = { ...prev };
        for (const k of Object.keys(m) as (keyof RawGameMetrics)[]) {
          if (k !== 'gameType')
            (sum as Record<string, number | string>)[k] = (prev[k] as number) + (m[k] as number);
        }
        out.set(t, sum);
      }
    }
    return [...out.values()];
  }

  async abandoned(gameType: string, at: Date): Promise<void> {
    this.#addMetrics(kstDay(at.getTime()), gameType, (m) => ({ ...m, abandoned: m.abandoned + 1 }));
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
    this.#recordMetrics(GAME_ID, r, {}, r.bids);
    this.#count(
      GAME_ID,
      r.endedAt,
      r.players.map((p) => p.guestId),
    );
  }

  async saveSummary(r: GameSummaryRecord): Promise<void> {
    this.#recordMetrics(r.gameType, r, r.summary, []);
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
    const dates = kstDays(range, now);
    const value = Promise.all([
      this.#store.daily(dates),
      this.#store.gameMetrics(dates[0] ?? kstDay(now)),
    ]).then(([days, raw]) => ({
      range,
      days,
      // ST-10: 판 수가 많은 순, 같으면 이름순
      perGame: raw
        .map(finalizeMetrics)
        .sort((a, b) => b.games - a.games || a.gameType.localeCompare(b.gameType)),
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
