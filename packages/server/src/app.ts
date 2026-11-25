import {
  createEndpoint,
  createRouter,
  defineRoom,
  defineServer,
  matchMaker,
  type Presence,
} from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { bulls, GAME_ID, gomoku, oneCard, parseStatsRange } from '@wmg/rules';
import type { ServerConfig } from './config.js';
import { LiarsDiceRoom } from './games/liars-dice/LiarsDiceRoom.js';
import { GomokuRoom } from './games/gomoku/GomokuRoom.js';
import { BullsRoom } from './games/bulls-and-cows/BullsRoom.js';
import { OneCardRoom } from './games/one-card/OneCardRoom.js';
import { activeRooms, runtime } from './games/liars-dice/runtime.js';
import type { StatsService } from './stats/stats.js';

export interface CreateServerOptions {
  readonly config: Pick<ServerConfig, 'corsOrigins'>;
  readonly presence?: Presence;
  readonly driver?: matchMaker.MatchMakerDriver;
  /** docs/specs/stats.md. 없으면 /visit, /stats가 503을 돌려준다 */
  readonly stats?: StatsService;
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

export function createGameServer({ config, presence, driver, stats }: CreateServerOptions) {
  configureCors(config.corsOrigins);

  const healthz = createEndpoint('/healthz', { method: 'GET' }, async () => ({
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

  return defineServer({
    rooms: {
      [GAME_ID]: defineRoom(LiarsDiceRoom),
      [gomoku.GOMOKU_ROOM_TYPE]: defineRoom(GomokuRoom),
      [oneCard.ONE_CARD_ROOM_TYPE]: defineRoom(OneCardRoom),
      [bulls.BULLS_ROOM_TYPE]: defineRoom(BullsRoom),
    },
    routes: createRouter({ healthz, visit, dailyStats }),
    transport: new WebSocketTransport({ pingInterval: 10_000, pingMaxRetries: 3 }),
    ...(presence ? { presence } : {}),
    ...(driver ? { driver } : {}),
    // 종료 신호는 index.ts에서 직접 처리한다 (진행 중인 방을 기다린 뒤 종료)
    gracefullyShutdown: false,
    greet: false,
  });
}
