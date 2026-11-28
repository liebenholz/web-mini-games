import { balloon } from '@wmg/rules';
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../src/framework/rng.js';
import { VirtualScheduler } from '../src/framework/scheduler.js';
import { BalloonMatch, type BalloonIO, type BalloonRecord } from '../src/games/balloon/BalloonMatch.js';
import { toBalloonSummary } from '../src/games/balloon/record.js';
import { FAST_TIMING } from './helpers.js';

class FakeBalloonIO implements BalloonIO {
  readonly broadcasts: { type: string; payload: Record<string, unknown> }[] = [];
  readonly sent: { type: string; payload: Record<string, unknown> }[] = [];
  readonly records: BalloonRecord[] = [];
  abandoned = 0;
  broadcast(type: string, payload: object): void {
    this.broadcasts.push({ type, payload: payload as Record<string, unknown> });
  }
  sendTo(_to: string, type: string, payload: object): void {
    this.sent.push({ type, payload: payload as Record<string, unknown> });
  }
  onAbandoned(): void {
    this.abandoned += 1;
  }
  onListingChange(): void {}
  onKick(): void {}
  onFinished(record: BalloonRecord): void {
    this.records.push(record);
  }
  last(type: string) {
    return [...this.broadcasts].reverse().find((b) => b.type === type)?.payload;
  }
  all(type: string) {
    return this.broadcasts.filter((b) => b.type === type).map((b) => b.payload);
  }
}

function setup(options: Partial<balloon.BalloonRoomOptions> = {}, seed = 7) {
  const io = new FakeBalloonIO();
  const scheduler = new VirtualScheduler();
  const match = new BalloonMatch(
    'BALOON',
    { ...balloon.DEFAULT_BALLOON_OPTIONS, fillWithBots: false, ...options },
    { io, scheduler, rng: createSeededRng(seed), timing: FAST_TIMING },
  );
  return { io, scheduler, match };
}

function joinOk(match: BalloonMatch, guestId: string, nickname: string): string {
  const r = match.join(guestId, nickname);
  if (!r.ok) throw new Error(`join failed: ${r.code}`);
  return r.playerId;
}

function started(n = 3, options: Partial<balloon.BalloonRoomOptions> = {}, seed = 7) {
  const ctx = setup(options, seed);
  const ids = Array.from({ length: n }, (_, i) => joinOk(ctx.match, `guest-player-${i}0000`, `사람${i}`));
  for (const id of ids.slice(1)) ctx.match.handle(id, 'set_ready', { ready: true });
  expect(ctx.match.handle(ids[0]!, 'start_game', {})).toEqual({ ok: true });
  ctx.scheduler.advance(FAST_TIMING.startCountdownMs);
  expect(ctx.match.phase).toBe('PLAYING');
  return { ...ctx, ids };
}

const turn = (m: BalloonMatch) => m.state.currentTurn;
const press = (m: BalloonMatch, id: string, type: 'pump' | 'end_turn' = 'pump') =>
  m.handle(id, type, { turnId: m.state.turnId });

/** 사람들이 한 번 누르고 넘기며 판을 끝까지 몰고 간다 */
function playToEnd(m: BalloonMatch): void {
  let guard = 0;
  while (m.phase === 'PLAYING' && guard < 400) {
    const id = turn(m);
    expect(press(m, id)).toEqual({ ok: true });
    if (m.phase === 'PLAYING' && turn(m) === id) expect(press(m, id, 'end_turn')).toEqual({ ok: true });
    guard += 1;
  }
}

describe('풍선 방: 시작 (BL-01, BL-02)', () => {
  it('터지는 범위를 공개하고 정확한 값은 숨기며, 첫 차례는 앉은 사람 중 한 명', () => {
    const g = started(3);
    expect(g.match.state.maxPops).toBe(24);
    expect(g.match.state.threshold).toBe(0);
    expect(g.match.state.total).toBe(0);
    expect(g.ids).toContain(turn(g.match));
  });

  it('첫 차례는 시드마다 고르게 바뀐다', () => {
    const firsts = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((s) => started(3, {}, s)).map((g) => g.ids.indexOf(turn(g.match))),
    );
    expect(firsts.size).toBe(3);
  });
});

describe('풍선 방: 펌프와 넘기기 (BL-03~BL-05)', () => {
  it('누를 때마다 전체가 늘고, 0번에서 넘기기는 거부, 3번째 뒤 자동으로 넘어간다', () => {
    const g = started(3);
    const a = turn(g.match);
    expect(press(g.match, a, 'end_turn')).toMatchObject({ code: 'INVALID_MOVE' });
    expect(press(g.match, a)).toEqual({ ok: true });
    expect(g.io.last('pumped')).toMatchObject({
      playerId: a,
      total: 1,
      turnPumps: 1,
      popped: false,
      isAuto: false,
    });
    expect(g.match.state.turnPumps).toBe(1);
    expect(press(g.match, a)).toEqual({ ok: true });
    if (g.match.phase !== 'PLAYING') return; // 터지는 횟수가 5라 이 시드에서는 일어나지 않는다
    const turnBefore = g.match.state.turnId;
    expect(press(g.match, a)).toEqual({ ok: true });
    if (g.match.phase !== 'PLAYING') return;
    expect(g.match.state.turnId).not.toBe(turnBefore);
    expect(turn(g.match)).not.toBe(a);
    expect(g.match.state.turnPumps).toBe(0);
    expect(g.match.state.history.at(-1)).toMatchObject({ playerId: a, pumps: 3 });
  });

  it('차례 아님·지난 turnId는 거부, 상태 그대로', () => {
    const g = started(2);
    const a = turn(g.match);
    const b = g.ids.find((x) => x !== a)!;
    expect(press(g.match, b)).toMatchObject({ code: 'NOT_YOUR_TURN' });
    expect(g.match.handle(a, 'pump', { turnId: 'old' })).toMatchObject({ code: 'STALE_TURN' });
    expect([g.match.state.total, g.match.state.turnPumps]).toEqual([0, 0]);
  });

  it('1번 누르고 넘기면 다음 사람 차례', () => {
    const g = started(3);
    const a = turn(g.match);
    expect(press(g.match, a)).toEqual({ ok: true });
    expect(press(g.match, a, 'end_turn')).toEqual({ ok: true });
    expect(turn(g.match)).not.toBe(a);
    expect(g.match.state.history.at(-1)).toMatchObject({ playerId: a, pumps: 1 });
  });
});

describe('풍선 방: 끝 (BL-06, BL-20, BL-22)', () => {
  it('BT-03, BT-04: 터뜨린 사람이 당첨되고, 끝나기 전엔 어디에도 터지는 횟수가 없다', () => {
    for (let seed = 1; seed <= 15; seed += 1) {
      const g = started(3, {}, seed);
      playToEnd(g.match);
      expect(g.match.phase).toBe('GAME_OVER');
      const over = g.io.last('game_over')!;
      const threshold = over.threshold as number;
      expect(threshold).toBeGreaterThanOrEqual(5);
      expect(threshold).toBeLessThanOrEqual(24);
      expect(g.match.state).toMatchObject({ threshold, total: threshold, loserId: over.loserId });
      expect(g.io.last('pumped')).toMatchObject({ playerId: over.loserId, total: threshold, popped: true });
      for (const b of g.io.broadcasts.filter((x) => x.type !== 'game_over'))
        expect(Object.keys(b.payload)).not.toContain('threshold');
      for (const s of g.io.sent) expect(Object.keys(s.payload)).not.toContain('threshold');
    }
  });

  it('판 기록: 당첨자 2위, 나머지 1위, 차례 수와 펌프 수', () => {
    const g = started(3, {}, 5);
    playToEnd(g.match);
    const record = g.io.records[0]!;
    const summary = toBalloonSummary(record);
    expect(summary).toMatchObject({ gameType: 'balloon', endReason: 'pop' });
    expect(summary.summary).toMatchObject({
      moveCount: record.turns.length,
      threshold: record.threshold,
      playerCount: 3,
    });
    expect(summary.players.map((p) => p.finalRank).sort()).toEqual([1, 1, 2]);
  });

  it('리매치하면 대기실로, 횟수와 기록을 지운다', () => {
    const g = started(2);
    playToEnd(g.match);
    expect(g.match.handle(g.ids[0]!, 'rematch', {})).toEqual({ ok: true });
    expect(g.match.phase).toBe('WAITING');
    expect([
      g.match.state.total,
      g.match.state.history.length,
      g.match.state.threshold,
      g.match.state.maxPops,
    ]).toEqual([0, 0, 0, 0]);
  });
});

describe('풍선 방: 시간 초과와 봇 (BL-10~BL-14)', () => {
  it('BT-05: 한 번도 안 눌렀으면 1~3번 대신 누르고, 2번 연속이면 봇 진행, 직접 누르면 돌려받는다', () => {
    let done = false;
    for (let seed = 1; seed <= 30 && !done; seed += 1) {
      const g = started(2, { maxPlayers: 2, turnSeconds: 10 }, seed);
      const a = turn(g.match);
      const b = g.ids.find((x) => x !== a)!;
      g.scheduler.advance(10_000 + 1);
      g.scheduler.advance(3_000);
      if (g.match.phase !== 'PLAYING') continue;
      const first = g.io.all('pumped').filter((p) => p.playerId === a);
      expect(first.length).toBeGreaterThanOrEqual(1);
      expect(first.length).toBeLessThanOrEqual(3);
      expect(first.every((p) => p.isAuto === true && p.isBot === false)).toBe(true);
      expect(g.match.state.players.get(a)?.autopilot).toBe(false);
      expect(turn(g.match)).toBe(b);
      // b가 직접 한 번 누르고 넘긴다
      if (press(g.match, b).ok !== true) continue;
      if (g.match.phase !== 'PLAYING') continue;
      if (turn(g.match) === b) press(g.match, b, 'end_turn');
      if (g.match.phase !== 'PLAYING') continue;
      // a의 두 번째 시간 초과 → autopilot
      g.scheduler.advance(10_000 + 1);
      g.scheduler.advance(3_000);
      if (g.match.phase !== 'PLAYING') continue;
      expect(g.match.state.players.get(a)?.autopilot).toBe(true);
      // a가 직접 누르면 돌려받는다
      let turns = 0;
      while (g.match.phase === 'PLAYING' && turn(g.match) !== a && turns < 5) {
        if (turn(g.match) === b) {
          press(g.match, b);
          if (g.match.phase === 'PLAYING' && turn(g.match) === b) press(g.match, b, 'end_turn');
        }
        turns += 1;
      }
      if (g.match.phase !== 'PLAYING' || turn(g.match) !== a) continue;
      // autopilot이라 서버가 먼저 누를 수 있다: 직접 누를 수 있는 순간(봇 지연 전)에 누른다
      const r = press(g.match, a);
      if (r.ok !== true) continue;
      expect(g.match.state.players.get(a)?.autopilot).toBe(false);
      done = true;
    }
    expect(done).toBe(true);
  });

  it('이미 눌렀으면 시간 초과는 그냥 넘기기: 연속 시간 초과로 세지 않는다', () => {
    let done = false;
    for (let seed = 1; seed <= 30 && !done; seed += 1) {
      const g = started(2, { turnSeconds: 10 }, seed);
      const a = turn(g.match);
      if (press(g.match, a).ok !== true || g.match.phase !== 'PLAYING') continue;
      g.scheduler.advance(10_000 + 1);
      expect(turn(g.match)).not.toBe(a);
      expect(g.match.state.history.at(-1)).toMatchObject({ playerId: a, pumps: 1, isAuto: false });
      expect(g.io.all('pumped').every((p) => p.isAuto === false)).toBe(true);
      expect(g.match.state.players.get(a)?.autopilot).toBe(false);
      done = true;
    }
    expect(done).toBe(true);
  });

  it('게임 중 나가면 봇이 이어서 하고 알린다 (차례였다면 이어서 누른다)', () => {
    const g = started(3);
    const me = turn(g.match);
    g.match.leave(me);
    expect(g.io.last('player_replaced')).toMatchObject({ playerId: me, reason: 'left' });
    expect(g.match.state.players.get(me)).toMatchObject({ replaced: true, isBot: true });
    g.scheduler.advance(FAST_TIMING.botDelayMaxMs + 5_000);
    expect(g.io.all('pumped').some((p) => p.playerId === me && p.isBot === true)).toBe(true);
  });

  it('BT-07: 혼자 시작하면 봇으로 채워 끝까지 간다 (사람은 시간 초과로)', () => {
    const ctx = setup({ fillWithBots: true, maxPlayers: 4, turnSeconds: 10 });
    const host = joinOk(ctx.match, 'guest-host-000000', '방장');
    expect(ctx.match.handle(host, 'start_game', {})).toEqual({ ok: true });
    ctx.scheduler.advance(FAST_TIMING.startCountdownMs);
    expect(ctx.match.state.players.size).toBe(4);
    ctx.scheduler.advance(2 * 60 * 60_000);
    expect(ctx.match.phase).toBe('GAME_OVER');
    expect(ctx.io.records).toHaveLength(1);
    const summary = toBalloonSummary(ctx.io.records[0]!);
    expect(summary.summary.autoMoveCount).toBeGreaterThan(0);
  });
});

describe('풍선 방: 10명과 옵션', () => {
  it('10명이 앉아 끝까지 가고, 터지는 범위는 5~52', () => {
    const g = started(10, { maxPlayers: 10 });
    expect(g.match.state.maxPops).toBe(52);
    expect(new Set([...g.match.state.players.values()].map((p) => p.seat)).size).toBe(10);
    playToEnd(g.match);
    expect(g.match.phase).toBe('GAME_OVER');
    expect(g.io.records[0]?.players).toHaveLength(10);
    expect(g.io.records[0]?.threshold).toBeLessThanOrEqual(52);
  });

  it('11번째는 ROOM_FULL, 정원은 지금 인원보다 줄일 수 없다', () => {
    const { match } = setup({ maxPlayers: 10 });
    const host = joinOk(match, 'guest-seat-0000000', '사람0');
    for (let i = 1; i < 10; i += 1) joinOk(match, `guest-seat-${i}000000`, `사람${i}`);
    expect(match.join('guest-extra-000000', '열한째')).toEqual({ ok: false, code: 'ROOM_FULL' });
    expect(match.handle(host, 'set_options', { options: { maxPlayers: 5 } })).toMatchObject({
      code: 'INVALID_OPTIONS',
    });
  });
});
