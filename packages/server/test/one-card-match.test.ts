import { oneCard } from '@wmg/rules';
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../src/framework/rng.js';
import { VirtualScheduler } from '../src/framework/scheduler.js';
import { OneCardMatch, type OneCardIO, type OneCardRecord } from '../src/games/one-card/OneCardMatch.js';
import { toOneCardSummary } from '../src/games/one-card/record.js';
import { FAST_TIMING } from './helpers.js';

type Sent = { to: string | null; type: string; payload: Record<string, unknown> };

class FakeIO implements OneCardIO {
  readonly sent: Sent[] = [];
  readonly records: OneCardRecord[] = [];
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
  onFinished(record: OneCardRecord): void {
    this.records.push(record);
  }
  last(type: string) {
    return [...this.sent].reverse().find((s) => s.type === type)?.payload;
  }
  hand(to: string): string[] {
    const h = [...this.sent].reverse().find((s) => s.type === 'your_hand' && s.to === to);
    return (h?.payload.cards as string[]) ?? [];
  }
}

function setup(humans: number, options: Partial<oneCard.OneCardRoomOptions> = {}, seed = 3) {
  const io = new FakeIO();
  const scheduler = new VirtualScheduler();
  const match = new OneCardMatch(
    'CARDS1',
    { ...oneCard.DEFAULT_ONE_CARD_OPTIONS, ...options },
    { io, scheduler, rng: createSeededRng(seed), timing: FAST_TIMING },
  );
  const ids: string[] = [];
  for (let i = 0; i < humans; i += 1) {
    const r = match.join(`guest-player-${i}`, `사람${i}`);
    if (!r.ok) throw new Error(r.code);
    ids.push(r.playerId);
  }
  for (const id of ids.slice(1)) match.handle(id, 'set_ready', { ready: true });
  expect(match.handle(ids[0]!, 'start_game', {})).toEqual({ ok: true });
  scheduler.advance(FAST_TIMING.startCountdownMs);
  expect(match.phase).toBe('PLAYING');
  return { io, scheduler, match, ids };
}

/** 좌석 순서는 입장 순서. 사람 → 봇 */
function base(hands: string[][], patch: Partial<oneCard.OneCardState> = {}): oneCard.OneCardState {
  return {
    hands,
    deck: ['S3', 'S4', 'S5', 'S6', 'S8', 'S9', 'S10', 'H3', 'H4', 'H6', 'D3', 'D4'],
    discard: ['H5'],
    chosenSuit: null,
    attack: 0,
    direction: 1,
    turn: 0,
    drawn: null,
    status: hands.map(() => 'playing' as const),
    finishOrder: [],
    bankruptOrder: [],
    over: false,
    ...patch,
  };
}

describe('OneCardMatch: 진행', () => {
  it('사람 1명 + 봇 3명(빈자리 채우기)으로 끝까지 진행되고 판 요약이 남는다', () => {
    const { io, scheduler, match, ids } = setup(1);
    expect(match.state.players.size).toBe(4);
    // 사람은 시간 초과 → 2번째부터 봇이 대신 (C-52)
    scheduler.runAll();
    expect(match.phase).toBe('GAME_OVER');
    expect(match.state.players.get(ids[0]!)?.autopilot).toBe(true);
    const record = io.records[0]!;
    expect(record.players.map((p) => p.rank).sort()).toEqual([1, 2, 3, 4]);
    const summary = toOneCardSummary(record);
    expect(summary.gameType).toBe('one_card');
    expect(summary.players.map((p) => p.seat)).toEqual([0, 1, 2, 3]);
    expect(JSON.stringify(summary)).not.toMatch(/"[SHDC](?:[2-9]|10|[AJQK])"/);
  });

  it('CT-16 C-40~C-42: 남의 패는 어떤 브로드캐스트·공유 상태에도 없고, your_hand는 본인에게만 간다', () => {
    const { io, scheduler, match, ids } = setup(2, { maxPlayers: 4 });
    let checkedState = 0;
    for (let i = 0; i < 400 && match.phase === 'PLAYING'; i += 1) {
      scheduler.step();
      const json = JSON.stringify(match.state.toJSON());
      // 공유 상태에 카드 목록이 없다: 맨 위 카드 하나만 카드 표기로 나온다
      const cards = json.match(/"(?:[SHDC](?:[2-9]|10|[AJQK])|J[BC])"/g) ?? [];
      expect(cards.length).toBeLessThanOrEqual(1);
      checkedState += 1;
    }
    expect(checkedState).toBeGreaterThan(10);
    for (const s of io.sent) {
      if (s.to === null) expect(Object.keys(s.payload)).not.toContain('cards');
      if (s.type === 'your_hand') expect(ids).toContain(s.to);
    }
    // 각자 받은 패는 실제 자기 패와 같다
    const g = match.game!;
    if (match.phase === 'PLAYING') {
      ids.forEach((id, seat) => expect(io.hand(id)).toEqual([...(g.hands[seat] ?? [])]));
    }
  });

  it('CE-01, CE-06: 내 차례가 아니면 NOT_YOUR_TURN, 지난 turnId는 STALE_TURN', () => {
    const { match, ids } = setup(2, { maxPlayers: 2 });
    match.replaceGameForTest(
      base([
        ['H9', 'C3'],
        ['D9', 'D8'],
      ]),
    );
    const turnId = match.state.turnId;
    expect(match.handle(ids[1]!, 'draw', { turnId })).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(match.handle(ids[0]!, 'draw', { turnId: 'old' })).toMatchObject({ ok: false, code: 'STALE_TURN' });
    expect(match.handle(ids[0]!, 'play', { card: 'XX', turnId })).toMatchObject({
      ok: false,
      code: 'INVALID_CARD',
    });
    expect(match.handle(ids[0]!, 'play', { card: 'C3', turnId })).toMatchObject({
      ok: false,
      code: 'INVALID_CARD',
    });
  });

  it('C-53: 가져온 카드를 낼 수 있으면 같은 차례가 이어지고, 남은 시간이 5초보다 적으면 5초로 늘린다', () => {
    const { io, scheduler, match, ids } = setup(2, { maxPlayers: 2, turnSeconds: 15 });
    match.replaceGameForTest(
      base(
        [
          ['C9', 'C8'],
          ['D9', 'D8'],
        ],
        { deck: ['H8', 'S3', 'S4'] },
      ),
    );
    scheduler.advance(13_000);
    const turnId = match.state.turnId;
    expect(match.handle(ids[0]!, 'draw', { turnId })).toEqual({ ok: true });
    expect(io.last('your_hand')).toEqual({ cards: ['C9', 'C8', 'H8'], drawn: 'H8' });
    expect(match.state.currentTurn).toBe(ids[0]);
    expect(match.state.deadline - scheduler.now()).toBe(5000);
    expect(match.handle(ids[0]!, 'play', { card: 'H8', turnId })).toEqual({ ok: true });
    expect(match.state.currentTurn).toBe(ids[1]);
  });
});

describe('OneCardMatch: 원카드 창 (C-30~C-32, C-57)', () => {
  function oneLeft() {
    const ctx = setup(3, { maxPlayers: 3 });
    ctx.match.replaceGameForTest(
      base([
        ['H9', 'C3'],
        ['D9', 'D8'],
        ['S9', 'S8'],
      ]),
    );
    const turnId = ctx.match.state.turnId;
    expect(ctx.match.handle(ctx.ids[0]!, 'play', { card: 'H9', turnId })).toEqual({ ok: true });
    const w = ctx.io.last('one_card_window')!;
    expect(w.playerId).toBe(ctx.ids[0]);
    return { ...ctx, windowId: w.windowId as string };
  }

  it('CT-19 C-32: 창이 열린 동안 다음 차례를 시작하지 않고, 내기·가져오기는 INVALID_STATE', () => {
    const { match, ids, windowId } = oneLeft();
    expect(match.state.currentTurn).toBe('');
    expect(match.state.windowId).toBe(windowId);
    expect(match.handle(ids[1]!, 'draw', { turnId: '' })).toMatchObject({ ok: false, code: 'INVALID_STATE' });
  });

  it('CT-12 C-31: 다른 사람이 먼저 누르면 1장 벌칙, 그 즉시 창이 닫히고 다음 차례가 시작된다', () => {
    const { io, match, ids, windowId } = oneLeft();
    expect(match.handle(ids[2]!, 'call_one_card', { windowId })).toEqual({ ok: true });
    expect(io.last('one_card_called')).toMatchObject({
      callerId: ids[2],
      playerId: ids[0],
      result: 'penalty',
    });
    expect(match.game!.hands[0]).toHaveLength(2);
    expect(match.state.currentTurn).toBe(ids[1]);
    // CE-07: 이미 닫힌 창
    expect(match.handle(ids[0]!, 'call_one_card', { windowId })).toMatchObject({
      ok: false,
      code: 'STALE_TURN',
    });
  });

  it('CT-12 C-31: 본인이 먼저 누르면 안전', () => {
    const { io, match, ids, windowId } = oneLeft();
    expect(match.handle(ids[0]!, 'call_one_card', { windowId })).toEqual({ ok: true });
    expect(io.last('one_card_called')).toMatchObject({ result: 'safe' });
    expect(match.game!.hands[0]).toHaveLength(1);
  });

  it('CT-12 C-31: 3초 동안 아무도 안 누르면 벌칙 없이 닫힌다', () => {
    const { io, scheduler, match, ids } = oneLeft();
    scheduler.advance(2999);
    expect(match.state.windowId).not.toBe('');
    scheduler.advance(1);
    expect(io.last('one_card_called')).toMatchObject({ result: 'expired', callerId: null });
    expect(match.state.currentTurn).toBe(ids[1]);
  });

  it('CT-19: 2인에서 K로 1장이 되면 창이 닫힌 뒤에 같은 사람 차례가 시작된다', () => {
    const { match, ids, io } = setup(2, { maxPlayers: 2 });
    match.replaceGameForTest(
      base([
        ['HK', 'C3'],
        ['D9', 'D8'],
      ]),
    );
    expect(match.handle(ids[0]!, 'play', { card: 'HK', turnId: match.state.turnId })).toEqual({ ok: true });
    const windowId = io.last('one_card_window')!.windowId as string;
    expect(match.state.currentTurn).toBe('');
    match.handle(ids[0]!, 'call_one_card', { windowId });
    expect(match.state.currentTurn).toBe(ids[0]);
  });

  it('CT-20 C-57: 봇이 1장이 되면 1~2초 사이에 누르고, 사람이 그보다 먼저 누르면 봇이 벌칙', () => {
    const run = (humanPresses: boolean) => {
      const { io, scheduler, match, ids } = setup(1, { maxPlayers: 2 });
      match.replaceGameForTest(
        base(
          [
            ['D9', 'D8'],
            ['H9', 'C3'],
          ],
          { turn: 1 },
        ),
      );
      while (!io.last('one_card_window')) scheduler.step();
      const w = io.last('one_card_window')!;
      expect(w).toBeDefined();
      if (humanPresses) match.handle(ids[0]!, 'call_one_card', { windowId: w.windowId });
      scheduler.advance(999);
      if (!humanPresses) expect(match.state.windowId).toBe(w.windowId);
      scheduler.advance(1001);
      return io.last('one_card_called')!;
    };
    expect(run(true)).toMatchObject({ result: 'penalty' });
    expect(run(false)).toMatchObject({ result: 'safe' });
  });
});

describe('OneCardMatch: 시간 초과와 퇴장 (C-51~C-55)', () => {
  it('C-51, C-52: 시간 초과면 자동으로 가져오고, 2번 연속이면 봇이 대신 둔다. 직접 두면 돌려받는다', () => {
    const { scheduler, match, ids } = setup(2, { maxPlayers: 2 });
    match.replaceGameForTest(
      base(
        [
          ['C9', 'C8'],
          ['S9', 'S8'],
        ],
        { deck: ['D3', 'D4', 'D6', 'D8', 'D9', 'D10'] },
      ),
    );
    scheduler.advance(30_000);
    expect(match.game!.hands[0]).toHaveLength(3);
    expect(match.state.players.get(ids[0]!)?.autopilot).toBe(false);
    // 사람1도 시간 초과 → 다시 사람0
    scheduler.advance(30_000);
    scheduler.advance(30_000);
    expect(match.state.players.get(ids[0]!)?.autopilot).toBe(true);
  });

  it('C-55: 게임 중 나가면 봇이 이어받고 다른 사람이 player_replaced(left)를 받는다', () => {
    const { io, scheduler, match, ids } = setup(2, { maxPlayers: 2 });
    match.replaceGameForTest(
      base(
        [
          ['C9', 'C8'],
          ['S9', 'H8'],
        ],
        { turn: 1 },
      ),
    );
    match.leave(ids[1]!);
    expect(io.last('player_replaced')).toMatchObject({ playerId: ids[1], reason: 'left' });
    scheduler.advance(FAST_TIMING.botDelayMaxMs);
    expect(io.last('card_played')).toMatchObject({ playerId: ids[1], card: 'H8', isAuto: true });
  });

  it('CE-08: 게임 중 사람이 모두 나가면 방을 닫고 기록하지 않는다', () => {
    const { io, match, ids } = setup(1);
    match.leave(ids[0]!);
    expect(io.abandoned).toBe(1);
    expect(io.records).toHaveLength(0);
  });

  it('C-37: 리매치하면 대기실로 돌아가고 패 정보가 지워진다', () => {
    const { scheduler, match, ids } = setup(1);
    scheduler.runAll();
    expect(match.handle(ids[0]!, 'rematch', {})).toEqual({ ok: true });
    expect(match.phase).toBe('WAITING');
    expect(match.state.topCard).toBe('');
    expect([...match.state.players.values()].every((p) => p.handCount === 0 && p.seat === -1)).toBe(true);
  });
});
