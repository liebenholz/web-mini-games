import { treasure } from '@wmg/rules';
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../src/framework/rng.js';
import { VirtualScheduler } from '../src/framework/scheduler.js';
import { TreasureMatch, type TreasureIO, type TreasureRecord } from '../src/games/treasure/TreasureMatch.js';
import { toTreasureSummary } from '../src/games/treasure/record.js';
import { FAST_TIMING } from './helpers.js';

class FakeIO implements TreasureIO {
  readonly broadcasts: { type: string; payload: Record<string, unknown> }[] = [];
  readonly sent: { to: string; type: string; payload: Record<string, unknown> }[] = [];
  readonly records: TreasureRecord[] = [];
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
  onFinished(record: TreasureRecord): void {
    this.records.push(record);
  }
  last(type: string) {
    return [...this.broadcasts].reverse().find((b) => b.type === type)?.payload;
  }
  all(type: string) {
    return this.broadcasts.filter((b) => b.type === type).map((b) => b.payload);
  }
}

function setup(options: Partial<treasure.TreasureRoomOptions> = {}, seed = 7) {
  const io = new FakeIO();
  const scheduler = new VirtualScheduler();
  const match = new TreasureMatch(
    'TREASU',
    { ...treasure.DEFAULT_TREASURE_OPTIONS, fillWithBots: false, ...options },
    { io, scheduler, rng: createSeededRng(seed), timing: FAST_TIMING },
  );
  return { io, scheduler, match };
}

function joinOk(match: TreasureMatch, guestId: string, nickname: string): string {
  const r = match.join(guestId, nickname);
  if (!r.ok) throw new Error(`join failed: ${r.code}`);
  return r.playerId;
}

function started(n = 3, options: Partial<treasure.TreasureRoomOptions> = {}, seed = 7) {
  const ctx = setup(options, seed);
  const ids = Array.from({ length: n }, (_, i) => joinOk(ctx.match, `guest-player-${i}0000`, `사람${i}`));
  for (const id of ids.slice(1)) ctx.match.handle(id, 'set_ready', { ready: true });
  expect(ctx.match.handle(ids[0]!, 'start_game', {})).toEqual({ ok: true });
  ctx.scheduler.advance(FAST_TIMING.startCountdownMs);
  expect(ctx.match.phase).toBe('PICKING');
  return { ...ctx, ids };
}

const rid = (m: TreasureMatch) => m.state.roundId;
/** TS의 흐름 좁히기를 피하려고 문자열로 읽는다 (시간이 지나며 단계가 바뀐다) */
const phaseOf = (m: TreasureMatch): string => m.phase;
const pick = (m: TreasureMatch, id: string, x: number, y: number) =>
  m.handle(id, 'pick', { x, y, roundId: rid(m) });
const lock = (m: TreasureMatch, id: string) => m.handle(id, 'lock_pick', { roundId: rid(m) });
const choose = (m: TreasureMatch, id: string, x: number, y: number) => {
  expect(pick(m, id, x, y)).toEqual({ ok: true });
  expect(lock(m, id)).toEqual({ ok: true });
};

/** 모두 (0,0)을 확정한다 (보물에서 거리가 같아 보이지 않아도, 같은 칸이라 모두 동점) */
function everyoneSame(g: ReturnType<typeof started>, x = 0, y = 0) {
  for (const id of g.ids) choose(g.match, id, x, y);
}

describe('보물 찾기 방: 시작과 선택 (BH-01~BH-03)', () => {
  it('보물과 선택은 상태에 없고, 모두 선택 단계에 참가한다', () => {
    const g = started(3);
    expect(g.match.state.replay).toBe(0);
    expect([...g.match.state.players.values()].every((p) => p.inRound && !p.locked)).toBe(true);
    expect(g.match.state.hasReveal).toBe(false);
    expect(g.match.state.reveal.picks.length).toBe(0);
  });

  it('HT-02: 확정 전에는 바꿀 수 있고, 확정 뒤에는 거부. 판 밖·소수는 INVALID_MOVE, 지난 roundId는 STALE_TURN', () => {
    const g = started(3);
    const a = g.ids[0]!;
    expect(lock(g.match, a)).toMatchObject({ code: 'INVALID_MOVE' });
    for (const [x, y] of [
      [9, 0],
      [0, 9],
      [2.5, 1],
      ['3', 1],
    ] as const)
      expect(g.match.handle(a, 'pick', { x, y, roundId: rid(g.match) })).toMatchObject({
        code: 'INVALID_MOVE',
      });
    expect(g.match.handle(a, 'pick', { x: 1, y: 1, roundId: 'old' })).toMatchObject({ code: 'STALE_TURN' });
    expect(pick(g.match, a, 1, 1)).toEqual({ ok: true });
    expect(pick(g.match, a, 2, 2)).toEqual({ ok: true });
    expect(g.io.sent.filter((s) => s.to === a && s.type === 'your_pick').at(-1)?.payload).toMatchObject({
      x: 2,
      y: 2,
      locked: false,
    });
    expect(lock(g.match, a)).toEqual({ ok: true });
    expect(g.match.state.players.get(a)?.locked).toBe(true);
    expect(pick(g.match, a, 3, 3)).toMatchObject({ code: 'INVALID_STATE' });
    expect(lock(g.match, a)).toMatchObject({ code: 'INVALID_STATE' });
  });
});

describe('보물 찾기 방: 공개와 당첨 (BH-04~BH-06, BH-20, BH-21)', () => {
  it('HT-03, HT-04, HT-06: 모두 확정하면 마감 전에 공개되고, 가장 먼 사람이 당첨. 그 전에는 보물·남의 선택이 없다', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const g = started(3, {}, seed);
      // 판의 모서리 세 곳: 보물이 어디든 대개 서로 다른 거리
      choose(g.match, g.ids[0]!, 0, 0);
      choose(g.match, g.ids[1]!, 8, 8);
      // 마지막 확정 전까지 공개 정보가 없다
      expect(g.match.phase).toBe('PICKING');
      for (const b of g.io.broadcasts) {
        expect(Object.keys(b.payload)).not.toContain('treasure');
        expect(Object.keys(b.payload)).not.toContain('x');
      }
      for (const s of g.io.sent)
        if (s.type !== 'your_pick') expect(Object.keys(s.payload)).not.toContain('treasure');
      // 남의 칸은 본인에게만: 다른 사람에게 간 your_pick이 없다
      for (const s of g.io.sent) if (s.type === 'your_pick') expect([g.ids[0], g.ids[1]]).toContain(s.to);
      choose(g.match, g.ids[2]!, 4, 4);
      expect(g.match.phase).toBe('REVEAL');
      const rev = g.io.last('reveal')!;
      const picks = rev.picks as { playerId: string; x: number; y: number; distSq: number }[];
      expect(picks).toHaveLength(3);
      const t = rev.treasure as { x: number; y: number };
      for (const p of picks) expect(p.distSq).toBe((p.x - t.x) ** 2 + (p.y - t.y) ** 2);
      expect(picks.map((p) => p.distSq)).toEqual([...picks.map((p) => p.distSq)].sort((a, b) => b - a));
      expect(g.match.state.hasReveal).toBe(true);
      expect(g.match.state.reveal.treasureX).toBe(t.x);
      g.scheduler.advance(FAST_TIMING.revealMs + 1);
      if (rev.tie) {
        expect(g.match.phase).toBe('PICKING');
      } else {
        expect(g.match.phase).toBe('GAME_OVER');
        expect(g.match.state.loserId).toBe((rev.far as string[])[0]);
        expect(g.io.last('game_over')).toMatchObject({ loserId: (rev.far as string[])[0], tieBreak: false });
      }
    }
  });

  it('판 기록: 당첨자 2위, 나머지 1위, 재대결 횟수', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const g = started(3, {}, seed);
      choose(g.match, g.ids[0]!, 0, 0);
      choose(g.match, g.ids[1]!, 8, 8);
      choose(g.match, g.ids[2]!, 4, 4);
      g.scheduler.advance(FAST_TIMING.revealMs + 1);
      if (phaseOf(g.match) !== 'GAME_OVER') continue;
      const s = toTreasureSummary(g.io.records[0]!);
      expect(s).toMatchObject({ gameType: 'treasure', endReason: 'farthest' });
      expect(s.summary).toMatchObject({ playerCount: 3, moveCount: 0, forced: false, tieBreak: false });
      expect(s.players.map((p) => p.finalRank).sort()).toEqual([1, 1, 2]);
      return;
    }
    throw new Error('no non-tie game found');
  });
});

describe('보물 찾기 방: 동점 재대결 (BH-07)', () => {
  it('HT-05: 모두 같은 칸이면 동점이라 모두 새 보물로 재대결하고, 재대결에서는 동점자만 참가한다', () => {
    const g = started(3);
    everyoneSame(g);
    expect(g.io.last('reveal')).toMatchObject({ tie: true, replay: 0 });
    expect((g.io.last('reveal')!.far as string[]).sort()).toEqual([...g.ids].sort());
    g.scheduler.advance(FAST_TIMING.revealMs + 1);
    expect(g.match.phase).toBe('PICKING');
    expect(g.match.state.replay).toBe(1);
    expect(g.match.state.hasReveal).toBe(false);
    expect(g.io.all('round_start')).toHaveLength(2);
  });

  it('재대결에서는 동점자만 고를 수 있고, 빠진 사람은 NOT_YOUR_TURN', () => {
    let done = false;
    for (let seed = 1; seed <= 60 && !done; seed += 1) {
      const g = started(3, {}, seed);
      // 0번 모서리 둘(좌상, 우하)은 보물이 정중앙 근처일 때 같은 거리: 두 명이 같은 칸, 한 명은 가운데
      choose(g.match, g.ids[0]!, 0, 0);
      choose(g.match, g.ids[1]!, 0, 0);
      choose(g.match, g.ids[2]!, 4, 4);
      const rev = g.io.last('reveal')!;
      const far = rev.far as string[];
      if (far.length !== 2) continue;
      g.scheduler.advance(FAST_TIMING.revealMs + 1);
      expect(g.match.phase).toBe('PICKING');
      const out = g.ids.find((x) => !far.includes(x))!;
      expect(g.match.state.players.get(out)?.inRound).toBe(false);
      expect(pick(g.match, out, 1, 1)).toMatchObject({ code: 'NOT_YOUR_TURN' });
      expect(pick(g.match, far[0]!, 1, 1)).toEqual({ ok: true });
      done = true;
    }
    expect(done).toBe(true);
  });

  it('최대 5번 재대결 뒤에도 같으면 무작위로 한 명이 당첨 (tieBreak)', () => {
    const g = started(2);
    for (let r = 0; r <= treasure.MAX_REPLAYS; r += 1) {
      expect(g.match.phase).toBe('PICKING');
      everyoneSame(g);
      g.scheduler.advance(FAST_TIMING.revealMs + 1);
    }
    expect(g.match.phase).toBe('GAME_OVER');
    expect(g.match.state.tieBreak).toBe(true);
    expect(g.ids).toContain(g.match.state.loserId);
    expect(g.io.last('game_over')).toMatchObject({ tieBreak: true });
    const s = toTreasureSummary(g.io.records[0]!);
    expect(s).toMatchObject({ endReason: 'tie_break' });
    expect(s.summary).toMatchObject({ moveCount: 5, rounds: 6, forced: true, tieBreak: true });
  });
});

describe('보물 찾기 방: 시간 초과와 봇 (BH-10~BH-14)', () => {
  it('HT-07: 마감에 골라 둔 칸은 그대로 확정, 못 골랐으면 무작위 칸(isAuto), 직접 고르면 연속 횟수가 풀린다', () => {
    const g = started(3, { pickSeconds: 10 });
    const [a, b, c] = g.ids as [string, string, string];
    expect(pick(g.match, a, 3, 3)).toEqual({ ok: true }); // 골라만 두고 확정은 안 함
    g.scheduler.advance(10_000 + 1);
    expect(g.match.phase).toBe('REVEAL');
    const picks = g.io.last('reveal')!.picks as { playerId: string; x: number; y: number; isAuto: boolean }[];
    expect(picks.find((p) => p.playerId === a)).toMatchObject({ x: 3, y: 3, isAuto: false });
    expect(picks.find((p) => p.playerId === b)?.isAuto).toBe(true);
    expect(picks.find((p) => p.playerId === c)?.isAuto).toBe(true);
    expect(g.match.state.players.get(b)?.autopilot).toBe(false);
  });

  it('못 골라서 대신 고른 일이 2번 연속이면 봇이 진행하고(autopilot), 직접 고르면 돌려받는다', () => {
    let done = false;
    // 두 번 연속 동점이 나와야 하므로 드문 경우다. 시드는 고정이라 한 번 찾으면 항상 같다
    for (let seed = 1; seed <= 3000 && !done; seed += 1) {
      const g = started(2, { maxPlayers: 2, pickSeconds: 10 }, seed);
      const [a, b] = g.ids as [string, string];
      choose(g.match, b, 0, 0);
      g.scheduler.advance(10_000 + 1); // a는 못 골라 대신 고름 (1번째)
      if (phaseOf(g.match) !== 'REVEAL') continue;
      g.scheduler.advance(FAST_TIMING.revealMs + 1);
      if (phaseOf(g.match) !== 'PICKING') continue; // 동점이 아니어서 끝났다
      // 재대결: 둘 다 참가. b 확정, a는 또 못 고름 (2번째)
      choose(g.match, b, 0, 0);
      g.scheduler.advance(10_000 + 1);
      if (phaseOf(g.match) !== 'REVEAL') continue;
      expect(g.match.state.players.get(a)?.autopilot).toBe(true);
      g.scheduler.advance(FAST_TIMING.revealMs + 1);
      if (phaseOf(g.match) !== 'PICKING') continue;
      // 이제 a는 봇이 대신 고른다 (1~2초 뒤 자동 확정, isAuto)
      choose(g.match, b, 0, 0);
      g.scheduler.advance(FAST_TIMING.botDelayMaxMs + 1);
      expect(g.match.state.players.get(a)?.locked).toBe(true);
      done = true;
    }
    expect(done).toBe(true);
  });

  it('게임 중 나가면 봇이 이어서 한다 (골라 둔 칸은 그대로)', () => {
    const g = started(3);
    const [a, b, c] = g.ids as [string, string, string];
    expect(pick(g.match, a, 7, 7)).toEqual({ ok: true });
    g.match.leave(a);
    expect(g.io.last('player_replaced')).toMatchObject({ playerId: a, reason: 'left' });
    choose(g.match, b, 1, 1);
    choose(g.match, c, 2, 2);
    g.scheduler.advance(FAST_TIMING.botDelayMaxMs + 1);
    expect(g.match.phase).toBe('REVEAL');
    const picks = g.io.last('reveal')!.picks as { playerId: string; x: number; y: number }[];
    expect(picks.find((p) => p.playerId === a)).toMatchObject({ x: 7, y: 7 });
  });

  it('혼자 시작하면 봇으로 채워 끝까지 간다 (사람은 시간 초과로)', () => {
    const ctx = setup({ fillWithBots: true, maxPlayers: 4, pickSeconds: 10 });
    const host = joinOk(ctx.match, 'guest-host-000000', '방장');
    expect(ctx.match.handle(host, 'start_game', {})).toEqual({ ok: true });
    ctx.scheduler.advance(FAST_TIMING.startCountdownMs);
    expect(ctx.match.state.players.size).toBe(4);
    ctx.scheduler.advance(60 * 60_000);
    expect(ctx.match.phase).toBe('GAME_OVER');
    expect(ctx.io.records).toHaveLength(1);
    expect(toTreasureSummary(ctx.io.records[0]!).summary.autoMoveCount).toBeGreaterThan(0);
  });
});

describe('보물 찾기 방: 10명, 리매치, 옵션', () => {
  it('10명이 앉아 끝까지 가고, 11번째는 ROOM_FULL', () => {
    const g = started(10, { maxPlayers: 10 });
    expect(g.match.state.players.size).toBe(10);
    g.scheduler.advance(60 * 60_000);
    expect(g.match.phase).toBe('GAME_OVER');
    expect(g.io.records[0]?.players).toHaveLength(10);
    const { match } = setup({ maxPlayers: 10 });
    for (let i = 0; i < 10; i += 1) joinOk(match, `guest-seat-${i}000000`, `사람${i}`);
    expect(match.join('guest-extra-000000', '열한째')).toEqual({ ok: false, code: 'ROOM_FULL' });
  });

  it('리매치하면 대기실로, 공개 정보와 확정 상태를 지운다', () => {
    const g = started(2);
    g.scheduler.advance(60 * 60_000);
    expect(g.match.phase).toBe('GAME_OVER');
    expect(g.match.handle(g.ids[0]!, 'rematch', {})).toEqual({ ok: true });
    expect(g.match.phase).toBe('WAITING');
    expect([g.match.state.hasReveal, g.match.state.loserId, g.match.state.replay]).toEqual([false, '', 0]);
    expect([...g.match.state.players.values()].every((p) => !p.locked && !p.inRound)).toBe(true);
  });
});
