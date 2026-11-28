import { thief } from '@wmg/rules';
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../src/framework/rng.js';
import { VirtualScheduler } from '../src/framework/scheduler.js';
import { ThiefMatch, type ThiefIO, type ThiefRecord } from '../src/games/thief/ThiefMatch.js';
import { toThiefSummary } from '../src/games/thief/record.js';
import { FAST_TIMING } from './helpers.js';

class FakeIO implements ThiefIO {
  readonly broadcasts: { type: string; payload: Record<string, unknown> }[] = [];
  readonly sent: { to: string; type: string; payload: Record<string, unknown> }[] = [];
  readonly records: ThiefRecord[] = [];
  broadcast(type: string, payload: object): void {
    this.broadcasts.push({ type, payload: payload as Record<string, unknown> });
  }
  sendTo(to: string, type: string, payload: object): void {
    this.sent.push({ to, type, payload: payload as Record<string, unknown> });
  }
  onAbandoned(): void {}
  onListingChange(): void {}
  onKick(): void {}
  onFinished(record: ThiefRecord): void {
    this.records.push(record);
  }
  last(type: string) {
    return [...this.broadcasts].reverse().find((b) => b.type === type)?.payload;
  }
  hand(id: string): string[] {
    const m = [...this.sent].reverse().find((s) => s.to === id && s.type === 'your_hand');
    return (m?.payload.cards as string[]) ?? [];
  }
}

function started(n = 3, options: Partial<thief.ThiefRoomOptions> = {}, seed = 5) {
  const io = new FakeIO();
  const scheduler = new VirtualScheduler();
  const match = new ThiefMatch(
    'THIEF1',
    { ...thief.DEFAULT_THIEF_OPTIONS, fillWithBots: false, maxPlayers: n, ...options },
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
  return { io, scheduler, match, ids };
}

const cur = (m: ThiefMatch) => m.state.currentTurn;
const targetCount = (m: ThiefMatch) => m.state.players.get(m.state.targetId)!.handCount;
const draw = (m: ThiefMatch, id: string, index: number) =>
  m.handle(id, 'draw', { index, turnId: m.state.turnId });

describe('도둑잡기 방: 시작 (TF-01~TF-04)', () => {
  it('나누고 첫 짝을 내며, 각자 자기 패만 받고 장수만 공유 상태에 있다', () => {
    const g = started(4);
    expect(g.match.phase).toBe('PLAYING');
    const total = [...g.match.state.players.values()].reduce((a, p) => a + p.handCount, 0);
    expect(total + g.match.state.pairs.length * 2).toBe(53);
    for (const id of g.ids) {
      expect(g.io.hand(id)).toHaveLength(g.match.state.players.get(id)!.handCount);
    }
    expect(g.ids).toContain(cur(g.match));
    expect(g.match.state.targetId).not.toBe(cur(g.match));
  });
});

describe('도둑잡기 방: 뽑기 (TF-05~TF-09, TE-01~TE-06)', () => {
  it('잘못된 요청은 거부하고 상태를 바꾸지 않는다', () => {
    const g = started(3);
    const a = cur(g.match);
    const b = g.ids.find((x) => x !== a)!;
    expect(draw(g.match, b, 0)).toMatchObject({ code: 'NOT_YOUR_TURN' });
    expect(g.match.handle(a, 'draw', { index: 0, turnId: 'old' })).toMatchObject({ code: 'STALE_TURN' });
    for (const bad of [-1, 99, 0.5, '0'])
      expect(g.match.handle(a, 'draw', { index: bad, turnId: g.match.state.turnId })).toMatchObject({
        code: 'INVALID_MOVE',
      });
    expect(g.match.state.draws).toBe(0);
  });

  it('뽑으면 차례가 넘어가고 turnId가 바뀌며, 같은 차례의 두 번째 입력은 STALE_TURN', () => {
    const g = started(3);
    const a = cur(g.match);
    const turn = g.match.state.turnId;
    const targetBefore = g.match.state.targetId;
    const countBefore = targetCount(g.match);
    expect(draw(g.match, a, 0)).toEqual({ ok: true });
    expect(g.match.state.turnId).not.toBe(turn);
    expect(g.match.state.draws).toBe(1);
    expect(g.match.handle(a, 'draw', { index: 0, turnId: turn })).toMatchObject({ code: 'STALE_TURN' });
    // 뽑힌 사람의 패는 한 장 줄었다 (빠졌을 수도 있다)
    expect(g.match.state.players.get(targetBefore)!.handCount).toBe(countBefore - 1);
    expect(g.io.last('drawn')).toMatchObject({ fromId: targetBefore, toId: a, isAuto: false });
  });
});

describe('도둑잡기 방: 숨긴 정보 (원칙 4, TA-08)', () => {
  it('브로드캐스트와 공유 상태에는 카드 번호가 없고, 남에게 보낸 패는 없다', () => {
    const g = started(4, {}, 11);
    for (let i = 0; i < 12 && g.match.phase === 'PLAYING'; i += 1) draw(g.match, cur(g.match), 0);
    const cardLike = /\b(?:[SHDC](?:10|[2-9AJQK])|JK)\b/;
    for (const b of g.io.broadcasts) {
      if (b.type === 'game_over') continue;
      expect(JSON.stringify(b.payload)).not.toMatch(cardLike);
    }
    const json = JSON.stringify(g.match.state.toJSON());
    if (g.match.phase === 'PLAYING') expect(json).not.toMatch(cardLike);
    // 내 패 메시지는 내 장수와 같고, 다른 사람에게 가지 않는다
    for (const s of g.io.sent.filter((x) => x.type === 'your_hand')) expect(g.ids).toContain(s.to);
    for (const id of g.ids) {
      if (g.match.phase !== 'PLAYING') break;
      expect(g.io.hand(id)).toHaveLength(g.match.state.players.get(id)!.handCount);
    }
  });
});

describe('도둑잡기 방: 시간 초과 (TF-12)', () => {
  const turnMs = () => thief.DEFAULT_THIEF_OPTIONS.turnSeconds * FAST_TIMING.msPerTurnSecond;

  it('TA-07: 시간 초과면 서버가 대신 뽑고, 두 번 연속이면 봇이 진행하며, 직접 뽑으면 돌려받는다', () => {
    const g = started(3, {}, 21);
    const a = cur(g.match);
    g.scheduler.advance(turnMs());
    expect(g.io.last('drawn')).toMatchObject({ toId: a, isAuto: true, isBot: false });
    expect(cur(g.match)).not.toBe(a);
    // 한 바퀴 돌아 a 차례가 다시 올 때까지 다른 사람들이 직접 뽑는다
    let guard = 0;
    while (cur(g.match) !== a && g.match.phase === 'PLAYING' && guard < 6) {
      draw(g.match, cur(g.match), 0);
      guard += 1;
    }
    if (g.match.phase !== 'PLAYING' || cur(g.match) !== a) return;
    g.scheduler.advance(turnMs());
    expect(g.match.state.players.get(a)!.autopilot).toBe(true);
    // 직접 뽑으면 돌려받는다
    let g2 = 0;
    while (cur(g.match) !== a && g.match.phase === 'PLAYING' && g2 < 6) {
      draw(g.match, cur(g.match), 0);
      g2 += 1;
    }
    if (g.match.phase === 'PLAYING' && cur(g.match) === a) {
      expect(draw(g.match, a, 0)).toEqual({ ok: true });
      expect(g.match.state.players.get(a)!.autopilot).toBe(false);
    }
  });
});

describe('도둑잡기 방: 끝까지 (TF-10, TF-11, 9장)', () => {
  it('봇 + 시간 초과로 끝까지 가며 당첨 1명, 기록과 순위가 맞다', () => {
    const io = new FakeIO();
    const scheduler = new VirtualScheduler();
    const match = new ThiefMatch(
      'THIEF2',
      { ...thief.DEFAULT_THIEF_OPTIONS, maxPlayers: 5, fillWithBots: true },
      { io, scheduler, rng: createSeededRng(9), timing: FAST_TIMING },
    );
    const h = match.join('guest-player-00000', '사람');
    if (!h.ok) throw new Error(h.code);
    for (let i = 0; i < 4; i += 1) match.handle(h.playerId, 'add_bot', {});
    expect(match.handle(h.playerId, 'start_game', {})).toEqual({ ok: true });
    scheduler.advance(FAST_TIMING.startCountdownMs);
    for (let i = 0; i < 3000 && match.phase === 'PLAYING'; i += 1) scheduler.advance(2000);
    expect(match.phase).toBe('GAME_OVER');
    const loserId = match.state.loserId;
    expect(loserId).not.toBe('');
    const finals = [...match.state.players.values()].filter((p) => p.finalHand.length > 0);
    expect(finals).toHaveLength(1);
    expect([...finals[0]!.finalHand]).toEqual([thief.JOKER]);
    expect(finals[0]!.id).toBe(loserId);
    const rec = io.records[0]!;
    expect(rec.players).toHaveLength(5);
    const s = toThiefSummary(rec);
    expect(s.gameType).toBe('thief');
    expect(s.players.filter((p) => p.finalRank === 2)).toHaveLength(1);
    expect(s.players.filter((p) => p.finalRank === 1)).toHaveLength(4);
    expect(s.summary).toMatchObject({ playerCount: 5, hasBot: true });
    expect(rec.pairs * 2 + 1).toBe(53);
  });

  it('리매치하면 패와 짝이 비워지고 대기실로 돌아간다', () => {
    const g = started(2, {}, 3);
    for (let i = 0; i < 80 && g.match.phase === 'PLAYING'; i += 1) draw(g.match, cur(g.match), 0);
    expect(g.match.phase).toBe('GAME_OVER');
    expect(g.match.handle(g.ids[0]!, 'rematch', {})).toEqual({ ok: true });
    expect(g.match.phase).toBe('WAITING');
    expect(g.match.state.pairs.length).toBe(0);
    for (const p of g.match.state.players.values()) {
      expect([p.handCount, p.out, p.finalHand.length]).toEqual([0, false, 0]);
    }
  });
});
