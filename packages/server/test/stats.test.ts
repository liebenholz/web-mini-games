import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kstDay, kstDays, parseStatsRange, type StatsResponse } from '@wmg/rules';
import { createGameServer } from '../src/app.js';
import { hashGuest, MemoryStats, StatsService, type StatsStore } from '../src/stats/stats.js';
import type { GameSummaryRecord } from '../src/persistence/types.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

function summary(gameType: string, endedAt: string, guests: (string | null)[]): GameSummaryRecord {
  return {
    gameId: crypto.randomUUID(),
    gameType,
    roomCode: 'ABCDEF',
    options: {},
    startedAt: new Date(endedAt),
    endedAt: new Date(endedAt),
    endReason: 'completed',
    summary: {},
    players: guests.map((guestId, seat) => ({
      guestId,
      nickname: `p${seat}`,
      seat,
      isBot: guestId === null,
      finalRank: seat + 1,
    })),
  };
}

describe('ST-04: 한국 시간 날짜', () => {
  it('UTC 15:00이 한국 시간 다음 날 자정이다', () => {
    expect(kstDay(Date.parse('2026-11-24T14:59:59Z'))).toBe('2026-11-24');
    expect(kstDay(Date.parse('2026-11-24T15:00:00Z'))).toBe('2026-11-25');
  });

  it('기간은 오늘을 포함해 오래된 날부터', () => {
    expect(kstDays(3, Date.parse('2026-11-25T03:00:00Z'))).toEqual([
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
    ]);
  });

  it('ST-03: 기간은 7/30/90만, 나머지는 30', () => {
    expect(parseStatsRange('7')).toBe(7);
    expect(parseStatsRange('90')).toBe(90);
    expect(parseStatsRange('365')).toBe(30);
    expect(parseStatsRange(undefined)).toBe(30);
  });
});

describe('MemoryStats', () => {
  it('ST-02: 판 수는 게임별로, 참여자는 봇을 빼고 하루에 한 번만 센다', async () => {
    const m = new MemoryStats();
    await m.saveSummary(summary('gomoku', '2026-11-24T01:00:00Z', ['guest-aaaaaaaa', null]));
    await m.saveSummary(summary('gomoku', '2026-11-24T02:00:00Z', ['guest-aaaaaaaa', 'guest-bbbbbbbb']));
    await m.saveSummary(summary('one_card', '2026-11-24T16:00:00Z', ['guest-aaaaaaaa'])); // 한국 11-25
    expect(await m.daily(['2026-11-24', '2026-11-25'])).toEqual([
      { date: '2026-11-24', visitors: 0, players: 2, games: { gomoku: 2 }, clientErrors: {} },
      { date: '2026-11-25', visitors: 0, players: 1, games: { one_card: 1 }, clientErrors: {} },
    ]);
  });
});

describe('StatsService', () => {
  const now = Date.parse('2026-11-25T03:00:00Z');

  it('ST-01: 형식이 틀린 게스트 ID는 거절하고, 같은 날 같은 게스트는 한 번만 저장한다', async () => {
    const writes: string[] = [];
    const store: StatsStore = {
      addVisit: async (day, hash) => void writes.push(`${day}:${hash}`),
      addClientErrors: async () => {},
      daily: async () => [],
    };
    const s = new StatsService(store, { now: () => now });
    expect(s.visit('x')).toBe(false);
    expect(s.visit(42)).toBe(false);
    expect(s.visit('guest-aaaaaaaa')).toBe(true);
    expect(s.visit('guest-aaaaaaaa')).toBe(true);
    await flush();
    expect(writes).toEqual([`2026-11-25:${hashGuest('guest-aaaaaaaa')}`]);
    expect(writes[0]).not.toContain('guest-aaaaaaaa');
  });

  it('ST-05: 1초에 새 방문 기록 수를 제한한다', async () => {
    let writes = 0;
    const store: StatsStore = {
      addVisit: async () => void (writes += 1),
      addClientErrors: async () => {},
      daily: async () => [],
    };
    const s = new StatsService(store, { now: () => now, maxVisitsPerSecond: 3 });
    for (let i = 0; i < 10; i += 1) s.visit(`guest-${String(i).padStart(8, '0')}`);
    await flush();
    expect(writes).toBe(3);
  });

  it('ST-06: 같은 기간 응답은 1분 동안 다시 집계하지 않는다', async () => {
    let t = now;
    let queries = 0;
    const store: StatsStore = {
      addVisit: async () => {},
      addClientErrors: async () => {},
      daily: async (days) => {
        queries += 1;
        return days.map((date) => ({ date, visitors: 0, players: 0, games: {}, clientErrors: {} }));
      },
    };
    const s = new StatsService(store, { now: () => t });
    const a = await s.get(7);
    expect(a.days).toHaveLength(7);
    expect(a.days.at(-1)?.date).toBe('2026-11-25');
    await s.get(7);
    expect(queries).toBe(1);
    t += 60_000;
    await s.get(7);
    expect(queries).toBe(2);
  });

  it('집계가 실패하면 그 응답을 재사용하지 않는다', async () => {
    let fail = true;
    const store: StatsStore = {
      addVisit: async () => {},
      addClientErrors: async () => {},
      daily: async () => {
        if (fail) throw new Error('db down');
        return [];
      },
    };
    const s = new StatsService(store, { now: () => now });
    await expect(s.get(7)).rejects.toThrow('db down');
    fail = false;
    await expect(s.get(7)).resolves.toMatchObject({ range: 7 });
  });
});

describe('ST-03, ST-07: /visit, /stats 엔드포인트', () => {
  let colyseus: ColyseusTestServer;
  const memory = new MemoryStats();

  beforeAll(async () => {
    colyseus = await boot(
      createGameServer({ config: { corsOrigins: [] }, stats: new StatsService(memory, { cacheMs: 0 }) }),
    );
  });
  afterAll(async () => colyseus.shutdown());

  it('방문을 기록하면 오늘 방문자에 잡히고, 응답에 게스트 ID가 없다', async () => {
    const ok = await colyseus.http.post('/visit', { body: { guestId: 'guest-visit-0001' } });
    expect(ok.statusCode).toBe(200);
    await memory.saveSummary(summary('gomoku', new Date().toISOString(), ['guest-visit-0001']));

    const res = await colyseus.http.get('/stats?days=7');
    expect(res.statusCode).toBe(200);
    const data = res.data as StatsResponse;
    expect(data.range).toBe(7);
    expect(data.days).toHaveLength(7);
    expect(data.days.at(-1)).toMatchObject({ visitors: 1, players: 1, games: { gomoku: 1 } });
    expect(JSON.stringify(data)).not.toContain('guest-visit-0001');
  });

  it('형식이 틀린 방문은 400', async () => {
    const res = await colyseus.http
      .post('/visit', { body: { guestId: '<script>' } })
      .catch((e: unknown) => e);
    expect((res as { statusCode?: number }).statusCode).toBe(400);
  });
});
