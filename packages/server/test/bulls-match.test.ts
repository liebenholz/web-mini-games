import { bulls } from '@wmg/rules';
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../src/framework/rng.js';
import { VirtualScheduler } from '../src/framework/scheduler.js';
import { BullsMatch, type BullsIO, type BullsRecord } from '../src/games/bulls-and-cows/BullsMatch.js';
import { toBullsSummary } from '../src/games/bulls-and-cows/record.js';
import { FAST_TIMING } from './helpers.js';

type Sent = { to: string | null; type: string; payload: Record<string, unknown> };

class FakeIO implements BullsIO {
  readonly sent: Sent[] = [];
  readonly records: BullsRecord[] = [];
  abandoned = 0;
  broadcast(type: string, payload: object): void {
    this.sent.push({ to: null, type, payload: payload as Record<string, unknown> });
  }
  sendTo(to: string, type: string, payload: object): void {
    this.sent.push({ to, type, payload: payload as Record<string, unknown> });
  }
  onAbandoned(): void {
    this.abandoned += 1;
  }
  onListingChange(): void {}
  onKick(): void {}
  onFinished(record: BullsRecord): void {
    this.records.push(record);
  }
  last(type: string) {
    return [...this.sent].reverse().find((s) => s.type === type)?.payload;
  }
}

/** humans명이 들어와 시작해서 비밀 숫자 단계까지 */
function setup(humans: 1 | 2, options: Partial<bulls.BullsRoomOptions> = {}, seed = 5) {
  const io = new FakeIO();
  const scheduler = new VirtualScheduler();
  const match = new BullsMatch(
    'BULLS1',
    { ...bulls.DEFAULT_BULLS_OPTIONS, ...options },
    { io, scheduler, rng: createSeededRng(seed), timing: FAST_TIMING },
  );
  const ids: string[] = [];
  for (let i = 0; i < humans; i += 1) {
    const r = match.join(`guest-player-${i}`, `사람${i}`);
    if (!r.ok) throw new Error(r.code);
    ids.push(r.playerId);
  }
  if (ids[1]) match.handle(ids[1], 'set_ready', { ready: true });
  expect(match.handle(ids[0]!, 'start_game', {})).toEqual({ ok: true });
  scheduler.advance(FAST_TIMING.startCountdownMs);
  expect(match.phase).toBe('SECRET');
  const seatOf = (id: string) => match.state.players.get(id)?.seat;
  return { io, scheduler, match, ids, seatOf };
}

/** 두 사람이 정한 비밀 숫자로 추측 단계까지. first = 선공 id, second = 후공 id */
function playing(secrets: [string, string] = ['102', '345'], options: Partial<bulls.BullsRoomOptions> = {}) {
  const ctx = setup(2, options);
  const [a, b] = ctx.ids as [string, string];
  const first = ctx.seatOf(a) === 0 ? a : b;
  const second = first === a ? b : a;
  expect(ctx.match.handle(first, 'set_secret', { digits: secrets[0] })).toEqual({ ok: true });
  expect(ctx.match.phase).toBe('SECRET');
  expect(ctx.match.handle(second, 'set_secret', { digits: secrets[1] })).toEqual({ ok: true });
  expect(ctx.match.phase).toBe('PLAYING');
  expect(ctx.match.state.currentTurn).toBe(first);
  const guess = (id: string, digits: string) =>
    ctx.match.handle(id, 'guess', { digits, turnId: ctx.match.state.turnId });
  return { ...ctx, first, second, guess };
}

describe('BullsMatch: 비밀 숫자 (B-30, BE-04)', () => {
  it('정한 비밀 숫자는 본인에게만 your_secret으로 가고, 공유 상태에는 정했는지만 보인다', () => {
    const { io, match, ids } = setup(2);
    match.handle(ids[0]!, 'set_secret', { digits: '987' });
    const own = io.sent.filter((s) => s.type === 'your_secret');
    expect(own).toEqual([{ to: ids[0], type: 'your_secret', payload: { digits: '987' } }]);
    expect(match.state.players.get(ids[0]!)?.secretSet).toBe(true);
    expect(JSON.stringify(match.state.toJSON())).not.toContain('987');
  });

  it('BE-04: 형식이 틀리면 INVALID_GUESS, 이미 정했으면 INVALID_STATE', () => {
    const { match, ids } = setup(2);
    expect(match.handle(ids[0]!, 'set_secret', { digits: '112' })).toMatchObject({
      ok: false,
      code: 'INVALID_GUESS',
    });
    expect(match.handle(ids[0]!, 'random_secret', {})).toEqual({ ok: true });
    expect(match.handle(ids[0]!, 'set_secret', { digits: '123' })).toMatchObject({
      ok: false,
      code: 'INVALID_STATE',
    });
  });

  it('BT-08 B-30: 60초 동안 안 정하면 무작위로 정해지고 본인에게 알린다', () => {
    const { io, scheduler, match, ids } = setup(2, { digits: 4 });
    scheduler.advance(60_000);
    expect(match.phase).toBe('PLAYING');
    for (const id of ids) {
      const mine = io.sent.find((s) => s.type === 'your_secret' && s.to === id);
      expect(bulls.isValidNumber(mine?.payload.digits, 4)).toBe(true);
    }
  });

  it('B-36: 봇은 바로 정하고, 사람이 정하면 바로 시작한다', () => {
    const { match, ids } = setup(1);
    expect(match.handle(ids[0]!, 'set_secret', { digits: '019' })).toEqual({ ok: true });
    expect(match.phase).toBe('PLAYING');
  });
});

describe('BullsMatch: 추측과 승부 (B-02~B-09)', () => {
  it('BE-01~BE-03: 내 차례 아님, 형식 틀림, 지난 turnId', () => {
    const { match, first, second, guess } = playing();
    expect(guess(second, '123')).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(guess(first, '11')).toMatchObject({ ok: false, code: 'INVALID_GUESS' });
    expect(match.handle(first, 'guess', { digits: '123', turnId: 'old' })).toMatchObject({
      ok: false,
      code: 'STALE_TURN',
    });
  });

  it('결과는 모두에게, 추측 기록에 남고 차례가 넘어간다', () => {
    const { io, match, first, second, guess } = playing();
    expect(guess(first, '354')).toEqual({ ok: true });
    expect(io.last('guess_result')).toMatchObject({
      playerId: first,
      guess: '354',
      strikes: 1,
      balls: 2,
      attempt: 1,
    });
    expect(match.state.history.length).toBe(1);
    expect(match.state.currentTurn).toBe(second);
  });

  it('BT-05 B-07: 선공이 맞히면 후공에게 마지막 기회, 후공도 맞히면 무승부이고 비밀 숫자를 공개한다', () => {
    const { io, match, first, second, guess } = playing();
    guess(first, '345');
    expect(io.last('last_chance')).toEqual({ playerId: second });
    expect(match.state.lastChance).toBe(true);
    expect(io.last('turn_start')).toMatchObject({ playerId: second, lastChance: true });
    guess(second, '102');
    expect(match.phase).toBe('GAME_OVER');
    expect(io.last('game_over')).toMatchObject({
      result: 'draw',
      winnerId: null,
      secrets: { [first]: '102', [second]: '345' },
    });
    expect(match.state.players.get(first)?.revealed).toBe('102');
  });

  it('BT-06 B-07: 후공이 먼저 맞히면 바로 이긴다', () => {
    const { io, first, second, guess } = playing();
    guess(first, '789');
    guess(second, '102');
    expect(io.last('game_over')).toMatchObject({ result: 'solved', winnerId: second });
    const summary = toBullsSummary(io.records[0]!);
    expect(summary).toMatchObject({ gameType: 'bulls_and_cows', endReason: 'solved' });
    expect(summary.players.map((p) => [p.seat, p.finalRank])).toEqual([
      [0, 2],
      [1, 1],
    ]);
    expect(JSON.stringify(summary)).not.toMatch(/102|345/);
  });

  it('BT-10 B-20~B-23: 끝나기 전에는 상대 비밀 숫자가 어떤 브로드캐스트·공유 상태에도 없다', () => {
    const { io, match, first, second, guess } = playing(['102', '345'], { maxAttempts: 10 });
    for (const [id, g] of [
      [first, '678'],
      [second, '678'],
      [first, '987'],
      [second, '987'],
    ] as const) {
      guess(id, g);
      const json = JSON.stringify(match.state.toJSON());
      expect(json).not.toContain('102');
      expect(json).not.toContain('345');
    }
    for (const s of io.sent.filter((x) => x.to === null)) {
      expect(JSON.stringify(s.payload)).not.toMatch(/102|345/);
    }
    for (const s of io.sent.filter((x) => x.type === 'your_secret'))
      expect(s.payload.digits).toBe(s.to === first ? '102' : '345');
  });

  it('BT-07 B-08: 시도 제한 10, 둘 다 못 맞히면 무승부', () => {
    const { io, first, second, guess } = playing();
    for (let i = 0; i < 10; i += 1) {
      guess(first, '789');
      guess(second, '789');
    }
    expect(io.last('game_over')).toMatchObject({ result: 'draw', attempts: { [first]: 10, [second]: 10 } });
  });
});

describe('BullsMatch: 시간, 퇴장, 봇 (B-31~B-35)', () => {
  it('BT-09 B-31, B-32: 시간 초과면 턴을 넘기고(시도 1회), 2번 연속이면 봇이 대신 추측한다', () => {
    const { io, scheduler, match, first } = playing();
    scheduler.advance(60_000);
    expect(io.last('turn_skipped')).toEqual({ playerId: first, attempt: 1 });
    expect(match.state.players.get(first)?.attempts).toBe(1);
    scheduler.advance(60_000); // 후공도 넘김
    scheduler.advance(60_000); // 선공 2번째
    expect(match.state.players.get(first)?.autopilot).toBe(true);
    // 이후 선공 차례에는 봇이 추측한다
    scheduler.advance(60_000);
    scheduler.advance(FAST_TIMING.botDelayMaxMs);
    expect(
      io.sent.some((s) => s.type === 'guess_result' && s.payload.playerId === first && s.payload.isAuto),
    ).toBe(true);
  });

  it('BT-11 B-34: 게임 중 나가면 봇이 이어서 추측하고 상대가 알림을 받는다', () => {
    const { io, scheduler, match, first, second, guess } = playing();
    guess(first, '789');
    match.leave(second);
    expect(io.last('player_replaced')).toMatchObject({ playerId: second, reason: 'left' });
    scheduler.advance(FAST_TIMING.botDelayMaxMs);
    expect(io.last('guess_result')).toMatchObject({ playerId: second, isAuto: true });
  });

  it('사람 1명 + 봇: 사람이 계속 시간을 넘겨도 판이 끝나고 판 요약이 남는다', () => {
    const { io, scheduler, match, ids } = setup(1);
    scheduler.runAll();
    expect(match.phase).toBe('GAME_OVER');
    expect(match.state.players.get(ids[0]!)?.autopilot).toBe(true);
    const record = io.records[0]!;
    expect(record.players).toHaveLength(2);
    expect(toBullsSummary(record).summary).toMatchObject({ digits: 3, hasBot: true });
  });

  it('BE-05: 게임 중 사람이 모두 나가면 방을 닫고 기록하지 않는다', () => {
    const { io, match, ids } = setup(1);
    match.leave(ids[0]!);
    expect(io.abandoned).toBe(1);
    expect(io.records).toHaveLength(0);
  });

  it('B-10: 리매치하면 대기실로 돌아가고 비밀 숫자와 기록이 지워진다', () => {
    const { match, first, second, guess } = playing();
    guess(first, '789');
    guess(second, '102');
    expect(match.handle(first, 'rematch', {})).toEqual({ ok: true });
    expect(match.phase).toBe('WAITING');
    expect(match.state.history.length).toBe(0);
    expect(
      [...match.state.players.values()].every((p) => !p.secretSet && p.revealed === '' && p.seat === -1),
    ).toBe(true);
  });
});
