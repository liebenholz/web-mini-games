import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer } from '../src/app.js';
import { ClientErrorService, errorFingerprint } from '../src/stats/clientErrors.js';
import { MemoryStats, StatsService, type ClientErrorRow } from '../src/stats/stats.js';

const report = {
  kind: 'js_error',
  message: 'boom',
  game: 'gomoku',
  route: 'room',
  release: 'abc1234',
  platform: 'android',
};
const now = Date.parse('2026-11-26T03:00:00Z'); // 한국 시간 11-26 12:00

function recordingStore() {
  const writes: ClientErrorRow[][] = [];
  let fail = false;
  return {
    writes,
    setFail: (v: boolean) => void (fail = v),
    addClientErrors: async (rows: readonly ClientErrorRow[]) => {
      if (fail) throw new Error('db down');
      writes.push([...rows]);
    },
  };
}

describe('클라이언트 오류 수집 서버 (docs/specs/client-errors.md)', () => {
  it('CE-05: 형식이 틀린 보고는 false', () => {
    const s = new ClientErrorService(recordingStore(), { now: () => now });
    expect(s.report({ ...report, kind: 'nope' })).toBe(false);
    expect(s.report('boom')).toBe(false);
    expect(s.report(report)).toBe(true);
  });

  it('CE-06, CE-07: 같은 오류는 지문 하나로 묶고, flush 때 한 번에 쓴다. 문구는 서버가 다시 정리한다', async () => {
    const store = recordingStore();
    const s = new ClientErrorService(store, { now: () => now });
    s.report({ ...report, message: 'room K7MQ2P gone' });
    s.report({ ...report, message: 'room ZZ9ZZ9 gone' });
    s.report({ ...report, kind: 'reconnect_failed', message: 'x' });
    expect(store.writes).toHaveLength(0);
    await s.flush();
    expect(store.writes).toHaveLength(1);
    const rows = store.writes[0] ?? [];
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.kind === 'js_error')).toMatchObject({
      day: '2026-11-26',
      message: 'room XXXXXX gone',
      count: 2,
      fingerprint: errorFingerprint('js_error', 'gomoku', 'room XXXXXX gone'),
    });
    await s.flush();
    expect(store.writes).toHaveLength(1);
  });

  it('CE-06: 1초에 받는 보고 수를 제한한다', async () => {
    const store = recordingStore();
    const s = new ClientErrorService(store, { now: () => now, maxReportsPerSecond: 3 });
    for (let i = 0; i < 10; i += 1) expect(s.report({ ...report, message: `e${i}` })).toBe(true);
    await s.flush();
    expect(store.writes[0]?.reduce((n, r) => n + r.count, 0)).toBe(3);
  });

  it('CE-06: 하루 지문 수를 넘기면 kind별 other 하나로 센다', async () => {
    const store = recordingStore();
    const s = new ClientErrorService(store, {
      now: () => now,
      maxFingerprintsPerDay: 2,
      maxReportsPerSecond: 100,
    });
    for (const m of ['a', 'b', 'c', 'd']) s.report({ ...report, message: m });
    await s.flush();
    const rows = store.writes[0] ?? [];
    expect(rows.map((r) => r.fingerprint)).toContain('other:js_error');
    expect(rows.find((r) => r.fingerprint === 'other:js_error')).toMatchObject({ count: 2, game: null });
  });

  it('CE-07: 저장이 실패하면 버리지 않고 다음 flush에 더해서 쓴다', async () => {
    const store = recordingStore();
    const s = new ClientErrorService(store, { now: () => now });
    store.setFail(true);
    s.report(report);
    await s.flush();
    s.report(report);
    store.setFail(false);
    await s.flush();
    expect(store.writes).toEqual([[expect.objectContaining({ count: 2 })]]);
  });
});

describe('CE-05, CE-08: /client-error, /stats 엔드포인트', () => {
  let colyseus: ColyseusTestServer;
  const memory = new MemoryStats();
  const clientErrors = new ClientErrorService(memory);

  beforeAll(async () => {
    colyseus = await boot(
      createGameServer({
        config: { corsOrigins: [] },
        stats: new StatsService(memory, { cacheMs: 0 }),
        clientErrors,
      }),
    );
  });
  afterAll(async () => colyseus.shutdown());

  it('보고를 받아 저장하면 /stats 오늘에 종류별 개수만 나온다', async () => {
    const ok = await colyseus.http.post('/client-error', { body: { ...report, game: null, route: 'hub' } });
    expect(ok.statusCode).toBe(200);
    await clientErrors.flush();
    const res = await colyseus.http.get('/stats?days=7');
    const today = (res.data as { days: { clientErrors: Record<string, number> }[] }).days.at(-1);
    expect(today?.clientErrors).toEqual({ js_error: 1 });
    expect(JSON.stringify(res.data)).not.toContain('boom');
  });

  it('형식이 틀리면 400', async () => {
    const res = await colyseus.http
      .post('/client-error', { body: { ...report, kind: '<script>' } })
      .catch((e: unknown) => e);
    expect((res as { statusCode?: number }).statusCode).toBe(400);
  });
});
