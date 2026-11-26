import {
  createEndpoint,
  createRouter,
  defineRoom,
  defineServer,
  matchMaker,
  type Presence,
} from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { bulls, GAME_ID, gomoku, oneCard, parseStatsRange, reversi } from '@wmg/rules';
import type { ServerConfig } from './config.js';
import { LiarsDiceRoom } from './games/liars-dice/LiarsDiceRoom.js';
import { GomokuRoom } from './games/gomoku/GomokuRoom.js';
import { ReversiRoom } from './games/reversi/ReversiRoom.js';
import { BullsRoom } from './games/bulls-and-cows/BullsRoom.js';
import { OneCardRoom } from './games/one-card/OneCardRoom.js';
import { activeRooms, runtime } from './games/liars-dice/runtime.js';
import { installMatchmakeLimit } from './framework/matchmakeLimit.js';
import { checkBearer, type MetricsCollector } from './metrics/metrics.js';
import type { ClientErrorService } from './stats/clientErrors.js';
import type { StatsService } from './stats/stats.js';

export interface CreateServerOptions {
  readonly config: Pick<ServerConfig, 'corsOrigins'> & Partial<Pick<ServerConfig, 'matchmakePerMinute'>>;
  readonly presence?: Presence;
  readonly driver?: matchMaker.MatchMakerDriver;
  /** docs/specs/stats.md. 없으면 /visit, /stats가 503을 돌려준다 */
  readonly stats?: StatsService;
  /** 운영 지표. token이 없으면 /metrics는 503 */
  readonly metrics?: { readonly collector: MetricsCollector; readonly token: string | null };
  /** docs/specs/client-errors.md. 없으면 /client-error가 503 */
  readonly clientErrors?: ClientErrorService;
}

/** 허용한 Origin에만 매칭 HTTP API를 연다. 목록이 비어 있으면(개발) 모두 허용 */
function configureCors(origins: readonly string[]): void {
  const defaults = matchMaker.controller.DEFAULT_CORS_HEADERS;
  matchMaker.controller.getCorsHeaders = (headers: Headers) => {
    const origin = headers.get('origin') ?? '';
    const allowed = origins.length === 0 ? origin || '*' : origins.includes(origin) ? origin : '';
    return { ...defaults, 'Access-Control-Allow-Origin': allowed, Vary: 'Origin' };
  };
  // Cloudflare가 520~526을 자체 오류 페이지로 바꾸지 않도록 표준 HTTP 상태를 쓴다
  matchMaker.controller.standardHttpStatus = true;
}

export function createGameServer({
  config,
  presence,
  driver,
  stats,
  metrics,
  clientErrors,
}: CreateServerOptions) {
  configureCors(config.corsOrigins);
  // 방 대량 생성 방지 (보안 점검 2026-11-27). 테스트 서버는 값을 넘기지 않아 꺼져 있다
  installMatchmakeLimit(config.matchmakePerMinute ?? 0);

  // 외부 감시 서비스(무료 플랜)는 HEAD로만 확인하므로 HEAD도 받는다 (운영 가이드 15-1)
  const healthz = createEndpoint('/healthz', { method: ['GET', 'HEAD'] }, async () => ({
    status: runtime.draining ? 'draining' : 'ok',
    rooms: activeRooms.size,
    inProgress: [...activeRooms].filter((r) => r.inProgress).length,
  }));

  // ST-01: 사이트를 열 때 하루 한 번 보낸다. 본문은 { guestId }
  const visit = createEndpoint('/visit', { method: 'POST' }, async (ctx) => {
    if (!stats) throw ctx.error(503, { code: 'STATS_UNAVAILABLE' });
    const body: unknown = ctx.body;
    const guestId =
      typeof body === 'object' && body !== null ? (body as { guestId?: unknown }).guestId : null;
    if (!stats.visit(guestId)) throw ctx.error(400, { code: 'INVALID_GUEST' });
    return { ok: true };
  });

  // ST-03: 누구나 볼 수 있는 일일 통계. 숫자 합계만 있고 닉네임·게스트 ID는 없다 (ST-07)
  const dailyStats = createEndpoint('/stats', { method: 'GET' }, async (ctx) => {
    if (!stats) throw ctx.error(503, { code: 'STATS_UNAVAILABLE' });
    const query: unknown = ctx.query;
    const days = typeof query === 'object' && query !== null ? (query as { days?: unknown }).days : undefined;
    try {
      return await stats.get(parseStatsRange(days));
    } catch (error) {
      runtime.log('warn', 'stats query failed', { error: String(error) });
      throw ctx.error(503, { code: 'STATS_UNAVAILABLE' });
    }
  });

  // CE-05: 브라우저 오류 보고. 본문은 ClientErrorReport (docs/specs/client-errors.md)
  const clientError = createEndpoint('/client-error', { method: 'POST' }, async (ctx) => {
    if (!clientErrors) throw ctx.error(503, { code: 'CLIENT_ERRORS_UNAVAILABLE' });
    if (!clientErrors.report(ctx.body)) throw ctx.error(400, { code: 'INVALID_REPORT' });
    return { ok: true };
  });

  // 운영 지표 (docs/ops/deploy-oracle.md 15장). 토큰을 아는 사람만 읽는다
  const metricsEndpoint = createEndpoint('/metrics', { method: 'GET' }, async (ctx) => {
    if (!metrics?.token) throw ctx.error(503, { code: 'METRICS_DISABLED' });
    if (!checkBearer(ctx.getHeader('authorization'), metrics.token)) {
      throw ctx.error(401, { code: 'UNAUTHORIZED' });
    }
    return metrics.collector.latest();
  });

  return defineServer({
    rooms: {
      [GAME_ID]: defineRoom(LiarsDiceRoom),
      [gomoku.GOMOKU_ROOM_TYPE]: defineRoom(GomokuRoom),
      [reversi.REVERSI_ROOM_TYPE]: defineRoom(ReversiRoom),
      [oneCard.ONE_CARD_ROOM_TYPE]: defineRoom(OneCardRoom),
      [bulls.BULLS_ROOM_TYPE]: defineRoom(BullsRoom),
    },
    routes: createRouter({ healthz, visit, dailyStats, clientError, metrics: metricsEndpoint }),
    transport: new WebSocketTransport({ pingInterval: 10_000, pingMaxRetries: 3 }),
    ...(presence ? { presence } : {}),
    ...(driver ? { driver } : {}),
    // 종료 신호는 index.ts에서 직접 처리한다 (진행 중인 방을 기다린 뒤 종료)
    gracefullyShutdown: false,
    greet: false,
  });
}
