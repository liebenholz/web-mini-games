import { yacht } from '@wmg/rules';
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../src/framework/rng.js';
import { VirtualScheduler } from '../src/framework/scheduler.js';
import { YachtMatch, type YachtIO, type YachtRecord } from '../src/games/yacht/YachtMatch.js';
import { toYachtSummary } from '../src/games/yacht/record.js';
import { FAST_TIMING } from './helpers.js';

class FakeIO implements YachtIO {
  readonly broadcasts: { type: string; payload: Record<string, unknown> }[] = [];
  readonly records: YachtRecord[] = [];
  broadcast(type: string, payload: object): void {
    this.broadcasts.push({ type, payload: payload as Record<string, unknown> });
  }
  sendTo(): void {}
  onAbandoned(): void {}
  onListingChange(): void {}
  onKick(): void {}
  onFinished(record: YachtRecord): void {
    this.records.push(record);
  }
  last(type: string) {
    return [...this.broadcasts].reverse().find((b) => b.type === type)?.payload;
  }
  all(type: string) {
    return this.broadcasts.filter((b) => b.type === type).map((b) => b.payload);
  }
}

function started(n = 2, options: Partial<yacht.YachtRoomOptions> = {}, seed = 5) {
  const io = new FakeIO();
  const scheduler = new VirtualScheduler();
  const match = new YachtMatch(
    'YACHT1',
    { ...yacht.DEFAULT_YACHT_OPTIONS, fillWithBots: false, maxPlayers: n, ...options },
    { io, scheduler, rng: createSeededRng(seed), timing: FAST_TIMING },
  );
  const ids = Array.from({ length: n }, (_, i) => {
    const r = match.join(`guest-player-${i}0000`, `사람${i}`);
    if (!r.ok) throw new Error(r.code);
    return r.playerId;
  });
  for (const id of ids.slice(1)) match.handle(id, 'set_ready', { ready: true });
  expect(match.handle(ids[0]!, 'start_game', {})).toEqual({ ok: true });
  scheduler.advance(FAST_TIMING.startCountdownMs);
  expect(match.phase).toBe('PLAYING');
  return { io, scheduler, match, ids };
}

const NONE = [false, false, false, false, false];
const roll = (m: YachtMatch, id: string, keep: boolean[] = NONE) =>
  m.handle(id, 'roll', { keep, turnId: m.state.turnId });
const score = (m: YachtMatch, id: string, category: number) =>
  m.handle(id, 'score', { category, turnId: m.state.turnId });
const cur = (m: YachtMatch) => m.state.currentTurn;

describe('요트 방: 시작과 굴리기 (YT-01~YT-04)', () => {
  it('점수표가 12칸 빈칸으로 시작하고 첫 차례는 앉은 사람 중 한 명', () => {
    const g = started(3);
    expect(g.ids).toContain(cur(g.match));
    for (const p of g.match.state.players.values()) {
      expect([...p.scores]).toEqual(new Array(12).fill(-1));
      expect(p.total).toBe(0);
    }
  });

  it('YA-02: 굴리면 주사위 5개와 rollNo가 공개되고, 남긴 주사위는 그대로', () => {
    const g = started(2);
    const a = cur(g.match);
    expect(roll(g.match, a)).toEqual({ ok: true });
    expect(g.match.state.dice.length).toBe(5);
    expect(g.match.state.rollNo).toBe(1);
    const before = [...g.match.state.dice];
    expect(roll(g.match, a, [true, true, false, false, true])).toEqual({ ok: true });
    const after = [...g.match.state.dice];
    expect([after[0], after[1], after[4]]).toEqual([before[0], before[1], before[4]]);
    expect(g.io.last('dice_rolled')).toMatchObject({ playerId: a, rollNo: 2, isAuto: false, isBot: false });
  });

  it('잘못된 요청은 거부하고 상태를 바꾸지 않는다', () => {
    const g = started(2);
    const a = cur(g.match);
    const b = g.ids.find((x) => x !== a)!;
    expect(roll(g.match, b)).toMatchObject({ code: 'NOT_YOUR_TURN' });
    expect(g.match.handle(a, 'roll', { keep: NONE, turnId: 'old' })).toMatchObject({ code: 'STALE_TURN' });
    expect(roll(g.match, a, [true, false, false, false, false])).toMatchObject({ code: 'INVALID_MOVE' });
    expect(roll(g.match, a, 'x' as unknown as boolean[])).toMatchObject({ code: 'INVALID_MOVE' });
    expect(score(g.match, a, 0)).toMatchObject({ code: 'INVALID_MOVE' }); // 굴리기 전 기록
    expect(g.match.state.rollNo).toBe(0);
    roll(g.match, a);
    expect(roll(g.match, a, [true, true, true, true, true])).toMatchObject({ code: 'INVALID_MOVE' });
    roll(g.match, a);
    roll(g.match, a);
    expect(g.match.state.rollNo).toBe(3);
    expect(roll(g.match, a)).toMatchObject({ code: 'INVALID_MOVE' });
  });
});

describe('요트 방: 기록과 차례 (YT-03, YT-05~YT-07)', () => {
  it('기록하면 점수·합계가 갱신되고 차례가 넘어가며 turnId가 바뀐다', () => {
    const g = started(2);
    const a = cur(g.match);
    roll(g.match, a);
    const dice = [...g.match.state.dice];
    const turnBefore = g.match.state.turnId;
    expect(score(g.match, a, yacht.CAT_CHOICE)).toEqual({ ok: true });
    const me = g.match.state.players.get(a)!;
    expect(me.scores[yacht.CAT_CHOICE]).toBe(dice.reduce((x, y) => x + y, 0));
    expect(me.total).toBe(me.scores[yacht.CAT_CHOICE]);
    expect(g.io.last('scored')).toMatchObject({ playerId: a, category: yacht.CAT_CHOICE, isAuto: false });
    expect(cur(g.match)).not.toBe(a);
    expect(g.match.state.turnId).not.toBe(turnBefore);
    expect(g.match.state.rollNo).toBe(0);
    expect(g.match.state.turnsDone).toBe(1);
  });

  it('쓴 칸은 다시 못 쓴다', () => {
    const g = started(2);
    const a = cur(g.match);
    roll(g.match, a);
    score(g.match, a, 0);
    const b = cur(g.match);
    roll(g.match, b);
    score(g.match, b, 0);
    roll(g.match, a);
    expect(score(g.match, a, 0)).toMatchObject({ code: 'INVALID_MOVE' });
  });
});

describe('요트 방: 시간 초과 (YT-10, YT-12)', () => {
  const turnMs = (o = yacht.DEFAULT_YACHT_OPTIONS) => o.turnSeconds * FAST_TIMING.msPerTurnSecond;

  it('안 굴렸으면 서버가 한 번 굴리고 가장 높은 칸에 기록한다', () => {
    const g = started(2);
    const a = cur(g.match);
    g.scheduler.advance(turnMs());
    expect(g.io.last('dice_rolled')).toMatchObject({ playerId: a, isAuto: true, rollNo: 1 });
    expect(g.io.last('scored')).toMatchObject({ playerId: a, isAuto: true });
    expect(cur(g.match)).not.toBe(a);
  });

  it('YA-06: 두 번 연속 시간 초과면 봇이 대신 하고, 직접 하면 돌려받는다', () => {
    const g = started(2);
    const a = cur(g.match);
    g.scheduler.advance(turnMs()); // a 시간 초과 1
    const b = cur(g.match);
    expect(b).not.toBe(a);
    roll(g.match, b);
    score(g.match, b, 0);
    expect(cur(g.match)).toBe(a);
    g.scheduler.advance(turnMs()); // a 시간 초과 2
    expect(g.match.state.players.get(a)!.autopilot).toBe(true);
    // b가 두고 나면 a 차례: 봇이 스스로 굴리고 기록한다
    roll(g.match, b);
    score(g.match, b, 1);
    expect(cur(g.match)).toBe(a);
    g.scheduler.advance(FAST_TIMING.botDelayMaxMs * 10);
    expect(g.io.all('scored').some((s) => s.playerId === a && s.isAuto === true && s.isBot === false)).toBe(
      true,
    );
    // 직접 하면 돌려받는다
    if (cur(g.match) === a) {
      roll(g.match, a);
      expect(g.match.state.players.get(a)!.autopilot).toBe(false);
    }
  });

  it('직접 굴린 차례가 시간 초과로 끝나도 연속 횟수로 세지 않는다', () => {
    const g = started(2);
    const a = cur(g.match);
    roll(g.match, a);
    g.scheduler.advance(turnMs());
    expect(g.io.last('scored')).toMatchObject({ playerId: a, isAuto: true });
    expect(g.match.state.players.get(a)!.autopilot).toBe(false);
  });
});

describe('요트 방: 끝까지 (YT-08, YT-11, 10장)', () => {
  it('봇 3명이 12차례씩 끝까지 두고 기록이 남으며 공동 순위가 맞다', () => {
    const io = new FakeIO();
    const scheduler = new VirtualScheduler();
    const match = new YachtMatch(
      'YACHT2',
      { ...yacht.DEFAULT_YACHT_OPTIONS, maxPlayers: 4, fillWithBots: true },
      { io, scheduler, rng: createSeededRng(9), timing: FAST_TIMING },
    );
    const h = match.join('guest-player-00000', '사람');
    if (!h.ok) throw new Error(h.code);
    for (let i = 0; i < 3; i += 1) match.handle(h.playerId, 'add_bot', {});
    expect(match.handle(h.playerId, 'start_game', {})).toEqual({ ok: true });
    scheduler.advance(FAST_TIMING.startCountdownMs);
    // 사람은 계속 시간 초과로 두게 하고 봇은 스스로 둔다
    for (let i = 0; i < 4000 && match.phase === 'PLAYING'; i += 1) scheduler.advance(2000);
    expect(match.phase).toBe('GAME_OVER');
    const rec = io.records[0]!;
    expect(rec.turns).toBe(48);
    expect(rec.players).toHaveLength(4);
    const over = io.last('game_over') as { ranking: { total: number; rank: number }[] };
    expect(over.ranking).toHaveLength(4);
    expect(over.ranking[0]!.rank).toBe(1);
    for (const r of over.ranking) {
      expect(r.rank).toBe(1 + over.ranking.filter((x) => x.total > r.total).length);
    }
    const s = toYachtSummary(rec);
    expect(s.gameType).toBe('yacht');
    expect(s.players.map((p) => p.finalRank).sort()).toEqual(over.ranking.map((r) => r.rank).sort());
    expect(s.summary).toMatchObject({ playerCount: 4, moveCount: 48, hasBot: true });
  });

  it('리매치하면 점수표가 비워지고 대기실로 돌아간다', () => {
    const g = started(2);
    for (let i = 0; i < 24; i += 1) {
      const id = cur(g.match);
      roll(g.match, id);
      const open = g.match.state.players.get(id)!.scores.findIndex((v) => v === -1);
      expect(score(g.match, id, open)).toEqual({ ok: true });
    }
    expect(g.match.phase).toBe('GAME_OVER');
    expect(g.io.records).toHaveLength(1);
    expect(g.match.handle(g.ids[0]!, 'rematch', {})).toEqual({ ok: true });
    expect(g.match.phase).toBe('WAITING');
    for (const p of g.match.state.players.values()) expect([...p.scores]).toEqual(new Array(12).fill(-1));
  });
});
