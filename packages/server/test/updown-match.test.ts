import { updown } from '@wmg/rules';
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../src/framework/rng.js';
import { VirtualScheduler } from '../src/framework/scheduler.js';
import { UpdownMatch, type UpdownIO, type UpdownRecord } from '../src/games/updown-bomb/UpdownMatch.js';
import { toUpdownSummary } from '../src/games/updown-bomb/record.js';
import { FAST_TIMING } from './helpers.js';

class FakeUpdownIO implements UpdownIO {
  readonly broadcasts: { type: string; payload: Record<string, unknown> }[] = [];
  readonly sent: { to: string; type: string; payload: Record<string, unknown> }[] = [];
  readonly records: UpdownRecord[] = [];
  abandoned = 0;
  broadcast(type: string, payload: object): void {
    this.broadcasts.push({ type, payload: payload as Record<string, unknown> });
  }
  sendTo(to: string, type: string, payload: object): void {
    this.sent.push({ to, type, payload: payload as Record<string, unknown> });
  }
  onAbandoned(): void {
    this.abandoned += 1;
  }
  onListingChange(): void {}
  onKick(): void {}
  onFinished(record: UpdownRecord): void {
    this.records.push(record);
  }
  last(type: string) {
    return [...this.broadcasts].reverse().find((b) => b.type === type)?.payload;
  }
  all(type: string) {
    return this.broadcasts.filter((b) => b.type === type).map((b) => b.payload);
  }
}

function setup(options: Partial<updown.UpdownRoomOptions> = {}, seed = 7) {
  const io = new FakeUpdownIO();
  const scheduler = new VirtualScheduler();
  const match = new UpdownMatch(
    'UPDOWN',
    { ...updown.DEFAULT_UPDOWN_OPTIONS, fillWithBots: false, ...options },
    { io, scheduler, rng: createSeededRng(seed), timing: FAST_TIMING },
  );
  return { io, scheduler, match };
}

function joinOk(match: UpdownMatch, guestId: string, nickname: string): string {
  const r = match.join(guestId, nickname);
  if (!r.ok) throw new Error(`join failed: ${r.code}`);
  return r.playerId;
}

/** 사람 n명을 앉히고 시작 */
function started(n = 3, options: Partial<updown.UpdownRoomOptions> = {}, seed = 7) {
  const ctx = setup(options, seed);
  const ids = Array.from({ length: n }, (_, i) => joinOk(ctx.match, `guest-player-${i}0000`, `사람${i}`));
  for (const id of ids.slice(1)) ctx.match.handle(id, 'set_ready', { ready: true });
  expect(ctx.match.handle(ids[0]!, 'start_game', {})).toEqual({ ok: true });
  ctx.scheduler.advance(FAST_TIMING.startCountdownMs);
  expect(ctx.match.phase).toBe('PLAYING');
  return { ...ctx, ids };
}

const turn = (m: UpdownMatch) => m.state.currentTurn;
const say = (m: UpdownMatch, id: string, value: unknown) =>
  m.handle(id, 'call_number', { value, turnId: m.state.turnId });

/** 폭탄을 모른 채 범위 끝부터 말해 판을 끝까지 몰고 간다 (매번 낮은 끝) */
function playToEnd(m: UpdownMatch): void {
  let guard = 0;
  while (m.phase === 'PLAYING' && guard < 300) {
    expect(say(m, turn(m), m.state.low)).toEqual({ ok: true });
    guard += 1;
  }
}

describe('업다운 방: 시작과 말하기 (UD-01~UD-05)', () => {
  it('범위 옵션대로 시작하고, 첫 차례는 앉은 사람 중 한 명', () => {
    const g = started(3, { rangeMax: 50 });
    expect([g.match.state.low, g.match.state.high]).toEqual([1, 50]);
    expect(g.ids).toContain(turn(g.match));
    expect(g.match.state.bomb).toBe(0);
  });

  it('첫 차례는 시드마다 고르게 바뀐다', () => {
    const firsts = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => started(3, {}, seed)).map((g) => g.ids.indexOf(turn(g.match))),
    );
    expect(firsts.size).toBe(3);
  });

  it('업이면 낮은 값, 다운이면 높은 값을 바꾸고 모두에게 알린다', () => {
    const g = started(2);
    const first = turn(g.match);
    expect(say(g.match, first, 1)).toEqual({ ok: true });
    const called = g.io.last('number_called')!;
    if (called.result === 'bomb') return; // 폭탄이 1이면 바로 끝 (드묾)
    expect(called).toMatchObject({
      playerId: first,
      value: 1,
      result: 'up',
      low: 2,
      high: 100,
      isAuto: false,
    });
    expect(g.match.state.low).toBe(2);
    expect(turn(g.match)).not.toBe(first);
    expect(g.match.state.history.length).toBe(1);
  });

  it('범위 밖·소수·문자는 OUT_OF_RANGE, 차례 아님·지난 turnId는 거부, 상태 그대로', () => {
    const g = started(2);
    const me = turn(g.match);
    const other = g.ids.find((x) => x !== me)!;
    for (const v of [0, 101, 2.5, '5']) expect(say(g.match, me, v)).toMatchObject({ code: 'OUT_OF_RANGE' });
    expect(say(g.match, other, 5)).toMatchObject({ code: 'NOT_YOUR_TURN' });
    expect(g.match.handle(me, 'call_number', { value: 5, turnId: 'old' })).toMatchObject({
      code: 'STALE_TURN',
    });
    expect([g.match.state.low, g.match.state.high, g.match.state.history.length]).toEqual([1, 100, 0]);
  });
});

describe('업다운 방: 끝 (UD-06, UD-07, UD-20, UD-22)', () => {
  it('UT-04, UT-06: 폭탄을 말한 사람이 당첨되고, 끝나기 전엔 어디에도 폭탄 숫자가 없다', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const g = started(3, { rangeMax: 50 }, seed);
      // 끝나기 전 공유 상태와 모든 메시지에 bomb 값이 없다
      playToEnd(g.match);
      expect(g.match.phase).toBe('GAME_OVER');
      const over = g.io.last('game_over')!;
      const bomb = over.bomb as number;
      expect(bomb).toBeGreaterThanOrEqual(1);
      expect(bomb).toBeLessThanOrEqual(50);
      expect(g.match.state.bomb).toBe(bomb);
      expect(g.match.state.loserId).toBe(over.loserId);
      const beforeEnd = g.io.broadcasts.filter((b) => b.type !== 'game_over');
      for (const b of beforeEnd) expect(Object.keys(b.payload)).not.toContain('bomb');
      for (const s of g.io.sent) expect(Object.keys(s.payload)).not.toContain('bomb');
      // 낮은 끝부터 말하면 폭탄을 직접 말하거나(bomb) 숫자 하나만 남는다(forced)
      if (over.forced) expect(g.match.state.low).toBe(g.match.state.high);
      else expect(g.io.last('number_called')).toMatchObject({ result: 'bomb', playerId: over.loserId });
    }
  });

  it('UT-05: 숫자 하나만 남으면 다음 차례인 사람이 바로 당첨 (forced)', () => {
    let seen = false;
    for (let seed = 1; seed <= 60 && !seen; seed += 1) {
      const g = started(2, { rangeMax: 50 }, seed);
      // 높은 끝부터 말하면 폭탄 바로 위까지 내려가 숫자 하나가 남는다 (폭탄이 1이 아니면)
      let guard = 0;
      while (g.match.phase === 'PLAYING' && guard < 100) {
        say(g.match, turn(g.match), g.match.state.high);
        guard += 1;
      }
      const over = g.io.last('game_over')!;
      if (!over.forced) continue;
      seen = true;
      const lastCaller = g.io.last('number_called')!.playerId;
      expect(over.loserId).not.toBe(lastCaller);
      expect(g.match.state).toMatchObject({ forced: true });
      expect(g.match.state.low).toBe(over.bomb);
    }
    expect(seen).toBe(true);
  });

  it('판 기록: 당첨자 2위, 나머지 1위, 말한 횟수와 forced', () => {
    const g = started(3, {}, 5);
    playToEnd(g.match);
    const record = g.io.records[0]!;
    const summary = toUpdownSummary(record);
    expect(summary).toMatchObject({ gameType: 'updown_bomb' });
    expect(summary.summary).toMatchObject({ moveCount: record.calls.length, rangeMax: 100, hasBot: false });
    const ranks = summary.players.map((p) => p.finalRank).sort();
    expect(ranks).toEqual([1, 1, 2]);
    expect(summary.endReason).toBe(record.forced ? 'forced' : 'bomb');
  });

  it('리매치하면 대기실로, 범위와 기록을 지운다', () => {
    const g = started(2);
    playToEnd(g.match);
    expect(g.match.handle(g.ids[0]!, 'rematch', {})).toEqual({ ok: true });
    expect(g.match.phase).toBe('WAITING');
    expect([g.match.state.low, g.match.state.high, g.match.state.history.length, g.match.state.bomb]).toEqual(
      [1, 100, 0, 0],
    );
  });
});

describe('업다운 방: 시간 초과와 퇴장 (UD-11~UD-14)', () => {
  it('UT-07: 시간 초과면 대신 말하고, 2번 연속이면 봇 진행, 직접 말하면 돌려받는다', () => {
    let done = false;
    for (let seed = 1; seed <= 30 && !done; seed += 1) {
      const g = started(2, { rangeMax: 200, turnSeconds: 10 }, seed);
      const a = turn(g.match);
      const b = g.ids.find((x) => x !== a)!;
      g.scheduler.advance(10_000 + 1);
      if (g.match.phase !== 'PLAYING') continue; // 대신 말한 수가 폭탄 (드묾)
      expect(g.io.last('number_called')).toMatchObject({ playerId: a, isAuto: true, isBot: false });
      expect(g.match.state.players.get(a)?.autopilot).toBe(false);
      expect(g.match.state.history.at(-1)?.isAuto).toBe(true);
      if (say(g.match, b, g.match.state.low).ok !== true || g.match.phase !== 'PLAYING') continue;
      g.scheduler.advance(10_000 + 1);
      if (g.match.phase !== 'PLAYING') continue;
      expect(g.match.state.players.get(a)?.autopilot).toBe(true);
      if (say(g.match, b, g.match.state.low).ok !== true || g.match.phase !== 'PLAYING') continue;
      // 이제 a 차례는 봇 지연 뒤 자동으로
      g.scheduler.advance(FAST_TIMING.botDelayMaxMs);
      if (g.match.phase !== 'PLAYING') continue;
      expect(g.io.last('number_called')).toMatchObject({ playerId: a, isAuto: true });
      if (say(g.match, b, g.match.state.low).ok !== true || g.match.phase !== 'PLAYING') continue;
      expect(turn(g.match)).toBe(a);
      expect(say(g.match, a, g.match.state.low)).toEqual({ ok: true });
      expect(g.match.state.players.get(a)?.autopilot).toBe(false);
      done = true;
    }
    expect(done).toBe(true);
  });

  it('게임 중 나가면 봇이 이어서 하고 알린다', () => {
    const g = started(3);
    const me = turn(g.match);
    g.match.leave(me);
    expect(g.io.last('player_replaced')).toMatchObject({ playerId: me, reason: 'left' });
    expect(g.match.state.players.get(me)).toMatchObject({ replaced: true, isBot: true });
    g.scheduler.advance(FAST_TIMING.botDelayMaxMs);
    expect(g.io.last('number_called')).toMatchObject({ playerId: me, isBot: true });
  });

  it('혼자 시작하면 봇으로 채워 끝까지 간다 (사람은 시간 초과로)', () => {
    const ctx = setup({ fillWithBots: true, maxPlayers: 4, turnSeconds: 10 });
    const host = joinOk(ctx.match, 'guest-host-000000', '방장');
    expect(ctx.match.handle(host, 'start_game', {})).toEqual({ ok: true });
    ctx.scheduler.advance(FAST_TIMING.startCountdownMs);
    expect(ctx.match.state.players.size).toBe(4);
    ctx.scheduler.advance(60 * 60_000);
    expect(ctx.match.phase).toBe('GAME_OVER');
    expect(ctx.io.records).toHaveLength(1);
  });

  it('정원은 지금 인원보다 줄일 수 없다', () => {
    const { match } = setup();
    const host = joinOk(match, 'guest-host-000000', '방장');
    joinOk(match, 'guest-two-0000000', '둘째');
    joinOk(match, 'guest-three-00000', '셋째');
    expect(match.handle(host, 'set_options', { options: { maxPlayers: 2 } })).toMatchObject({
      code: 'INVALID_OPTIONS',
    });
    expect(match.handle(host, 'set_options', { options: { rangeMax: 200 } })).toEqual({ ok: true });
    expect(match.state.high).toBe(200);
  });
});
