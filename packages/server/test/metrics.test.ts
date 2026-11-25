import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from '../src/app.js';
import { loadConfig, ConfigError } from '../src/config.js';
import { RateLimiter } from '../src/framework/rateLimiter.js';
import {
  checkBearer,
  counters,
  MetricsCollector,
  type ActiveRoom,
  type Counters,
  type SystemProbe,
} from '../src/metrics/metrics.js';

const MB = 1024 * 1024;

/** 시계와 시스템 값을 손으로 움직이는 가짜 측정기 */
function fakeProbe() {
  const state = { now: 1_000_000, cpuMicros: 0, delay: { p50: 0, p99: 0, max: 0 } };
  const probe: SystemProbe = {
    now: () => state.now,
    memory: () => ({
      rss: 200 * MB,
      heapUsed: 50 * MB,
      heapTotal: 80 * MB,
      external: 5 * MB,
      arrayBuffers: 0,
    }),
    cpu: (prev) => {
      const base = prev ? prev.user : 0;
      return { user: state.cpuMicros - base, system: 0 };
    },
    elu: () => ({ idle: 0, active: 0, utilization: 0.25 }),
    takeDelay: () => state.delay,
    stop: () => {},
  };
  return { state, probe };
}

function room(roomName: string, inProgress: boolean, clients: number): ActiveRoom {
  return { roomName, inProgress, clients: { length: clients } };
}

describe('운영 지표 수집기', () => {
  it('간격 동안의 변화량과 초당 메시지 수를 계산한다', () => {
    const { state, probe } = fakeProbe();
    const c: Counters = { messages: 100, rateLimited: 0, dbRetries: 0, dbDropped: 0 };
    const collector = new MetricsCollector({ rooms: () => [], counters: c, probe });

    state.now += 10_000;
    state.cpuMicros = 2_000_000; // 10초 동안 CPU 2초 = 20%
    state.delay = { p50: 10.04, p99: 42.36, max: 120 };
    c.messages += 50;
    c.rateLimited += 3;
    c.dbRetries += 1;

    const s = collector.sample();
    expect(s.windowSec).toBe(10);
    expect(s.cpuPercent).toBe(20);
    expect(s.window).toMatchObject({
      messages: 50,
      messagesPerSec: 5,
      rateLimited: 3,
      dbRetries: 1,
      dbDropped: 0,
    });
    expect(s.totals.messages).toBe(150);
    expect(s.eventLoop).toEqual({ p50Ms: 10, p99Ms: 42.4, maxMs: 120, utilization: 0.25 });
    expect(s.memoryMb).toEqual({ rss: 200, heapUsed: 50, heapTotal: 80, external: 5 });

    // 다음 표본은 직전 표본 이후만 센다
    state.now += 5_000;
    c.messages += 5;
    const next = collector.sample();
    expect(next.window.messages).toBe(5);
    expect(next.window.rateLimited).toBe(0);
    expect(next.uptimeSec).toBe(15);
  });

  it('게임별 방 수, 진행 중인 방, 접속 수를 센다', () => {
    const { probe } = fakeProbe();
    const rooms = [room('gomoku', true, 2), room('gomoku', false, 1), room('liars_dice', true, 4)];
    const s = new MetricsCollector({ rooms: () => rooms, probe }).sample();
    expect(s.rooms).toEqual({ total: 3, inProgress: 2, clients: 7, byGame: { gomoku: 2, liars_dice: 1 } });
  });

  it('latest()는 표본이 없으면 새로 만들고, 있으면 그대로 돌려준다', () => {
    const { state, probe } = fakeProbe();
    const collector = new MetricsCollector({ rooms: () => [], probe });
    const first = collector.latest();
    state.now += 1000;
    expect(collector.latest()).toBe(first);
  });

  it('빈도 제한기를 지나는 메시지와 막힌 메시지를 센다 (E-14)', () => {
    const before = { ...counters };
    const limiter = new RateLimiter({ limit: 2, windowMs: 1000, maxStrikes: 99, strikeWindowMs: 10_000 });
    for (let i = 0; i < 5; i += 1) limiter.hit('a', 0);
    expect(counters.messages - before.messages).toBe(5);
    expect(counters.rateLimited - before.rateLimited).toBe(3);
  });
});

describe('/metrics 토큰', () => {
  it('Bearer 토큰이 정확히 같을 때만 통과한다', () => {
    const token = 'x'.repeat(32);
    expect(checkBearer(`Bearer ${token}`, token)).toBe(true);
    expect(checkBearer(`Bearer ${token}y`, token)).toBe(false);
    expect(checkBearer(token, token)).toBe(false);
    expect(checkBearer(null, token)).toBe(false);
    expect(checkBearer(`Bearer ${token}`, null)).toBe(false);
  });

  it('METRICS_TOKEN은 24자 이상이어야 하고, 간격 기본값은 60초다', () => {
    expect(() => loadConfig({ METRICS_TOKEN: 'short' })).toThrow(ConfigError);
    const config = loadConfig({ METRICS_TOKEN: 'y'.repeat(24) });
    expect(config.metricsToken).toBe('y'.repeat(24));
    expect(config.metricsIntervalSeconds).toBe(60);
    expect(loadConfig({}).metricsToken).toBeNull();
  });
});

const status = (p: Promise<unknown>) =>
  p.then(
    (r) => (r as { statusCode: number }).statusCode,
    (e: unknown) => (e as { statusCode?: number }).statusCode,
  );

describe('/metrics 엔드포인트 (토큰 설정)', () => {
  const token = 'metrics-test-token-0123456789';
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    const collector = new MetricsCollector({
      rooms: () => [room('gomoku', true, 2)],
      probe: fakeProbe().probe,
    });
    colyseus = await boot(createGameServer({ config: { corsOrigins: [] }, metrics: { collector, token } }));
  });
  afterAll(async () => colyseus.shutdown());

  it('올바른 토큰이면 지표를 돌려준다', async () => {
    const res = await colyseus.http.get('/metrics', { headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.data).toMatchObject({ rooms: { total: 1, byGame: { gomoku: 1 } } });
  });

  it('토큰이 없거나 틀리면 401', async () => {
    expect(await status(colyseus.http.get('/metrics'))).toBe(401);
    expect(await status(colyseus.http.get('/metrics', { headers: { authorization: 'Bearer nope' } }))).toBe(
      401,
    );
  });
});

describe('/metrics 엔드포인트 (토큰 없음)', () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    const collector = new MetricsCollector({ rooms: () => [], probe: fakeProbe().probe });
    colyseus = await boot(
      createGameServer({ config: { corsOrigins: [] }, metrics: { collector, token: null } }),
    );
  });
  afterAll(async () => colyseus.shutdown());

  it('서버에 토큰을 설정하지 않으면 503 (METRICS_DISABLED)', async () => {
    const get = () =>
      colyseus.http.get('/metrics', { headers: { authorization: 'Bearer anything-at-all-0123456789' } });
    // 테스트 HTTP 클라이언트가 앞 describe에서 닫힌 서버와의 keep-alive 연결을 한 번 재사용해 끊길 수 있다
    await get().catch(() => {});
    expect(await status(get())).toBe(503);
  });
});
