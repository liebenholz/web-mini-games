import { reversi } from '@wmg/rules';
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../src/framework/rng.js';
import { VirtualScheduler } from '../src/framework/scheduler.js';
import { ReversiMatch, type ReversiIO, type ReversiRecord } from '../src/games/reversi/ReversiMatch.js';
import { toReversiSummary } from '../src/games/reversi/record.js';
import { FAST_TIMING } from './helpers.js';

class FakeReversiIO implements ReversiIO {
  readonly broadcasts: { type: string; payload: Record<string, unknown> }[] = [];
  readonly records: ReversiRecord[] = [];
  readonly kicked: string[] = [];
  abandoned = 0;
  broadcast(type: string, payload: object): void {
    this.broadcasts.push({ type, payload: payload as Record<string, unknown> });
  }
  sendTo(): void {}
  onAbandoned(): void {
    this.abandoned += 1;
  }
  onListingChange(): void {}
  onKick(playerId: string): void {
    this.kicked.push(playerId);
  }
  onFinished(record: ReversiRecord): void {
    this.records.push(record);
  }
  last(type: string) {
    return [...this.broadcasts].reverse().find((b) => b.type === type)?.payload;
  }
  all(type: string) {
    return this.broadcasts.filter((b) => b.type === type).map((b) => b.payload);
  }
}

function setup(options: Partial<reversi.ReversiRoomOptions> = {}, seed = 7) {
  const io = new FakeReversiIO();
  const scheduler = new VirtualScheduler();
  const match = new ReversiMatch(
    'REVRSI',
    { ...reversi.DEFAULT_REVERSI_OPTIONS, fillWithBots: false, ...options },
    { io, scheduler, rng: createSeededRng(seed), timing: FAST_TIMING },
  );
  return { io, scheduler, match };
}

function joinOk(match: ReversiMatch, guestId: string, nickname: string): string {
  const r = match.join(guestId, nickname);
  if (!r.ok) throw new Error(`join failed: ${r.code}`);
  return r.playerId;
}

/** 방장 + 손님을 앉히고 시작해서 대국까지 */
function started(options: Partial<reversi.ReversiRoomOptions> = {}, seed = 7) {
  const ctx = setup(options, seed);
  const host = joinOk(ctx.match, 'guest-host-01', '방장');
  const guest = joinOk(ctx.match, 'guest-guest-01', '손님');
  ctx.match.handle(guest, 'set_ready', { ready: true });
  expect(ctx.match.handle(host, 'start_game', {})).toEqual({ ok: true });
  ctx.scheduler.advance(FAST_TIMING.startCountdownMs);
  expect(ctx.match.phase).toBe('PLAYING');
  const color = (id: string) => ctx.match.state.players.get(id)?.color;
  const black = color(host) === 'black' ? host : guest;
  const white = black === host ? guest : host;
  return { ...ctx, host, guest, black, white };
}

/** 혼자 들어와 봇과 둔다 */
function vsBot(options: Partial<reversi.ReversiRoomOptions> = {}, seed = 7) {
  const ctx = setup({ fillWithBots: true, ...options }, seed);
  const host = joinOk(ctx.match, 'guest-host-01', '방장');
  expect(ctx.match.handle(host, 'start_game', {})).toEqual({ ok: true });
  ctx.scheduler.advance(FAST_TIMING.startCountdownMs);
  return { ...ctx, host };
}

function place(match: ReversiMatch, playerId: string, label: string) {
  const p = reversi.parseCoord(label)!;
  return match.handle(playerId, 'place', { x: p.x, y: p.y, turnId: match.state.turnId });
}

const cell = (match: ReversiMatch, label: string) =>
  match.state.board[reversi.indexOf(reversi.parseCoord(label)!)];

describe('리버시 방: 시작 (RV-01, RV-02, RV-08)', () => {
  it('RV-01: 처음 배치로 시작하고 흑부터 둔다', () => {
    const g = started({ blackPolicy: 'host' });
    expect(g.black).toBe(g.host);
    expect(g.match.state.currentTurn).toBe(g.host);
    expect(cell(g.match, 'D4')).toBe(reversi.WHITE);
    expect(cell(g.match, 'E4')).toBe(reversi.BLACK);
    expect(cell(g.match, 'D5')).toBe(reversi.BLACK);
    expect(cell(g.match, 'E5')).toBe(reversi.WHITE);
    expect([...g.match.state.board].filter((c) => c !== 0)).toHaveLength(4);
  });

  it('RV-02: 방장 / 상대 / 무작위 옵션대로 흑을 정한다', () => {
    expect(started({ blackPolicy: 'guest' }).black).toBe(started({ blackPolicy: 'guest' }).guest);
    const sides = new Set(
      [1, 2, 3, 4, 5, 6].map((seed) => {
        const g = started({ blackPolicy: 'random' }, seed);
        return g.black === g.host ? 'host' : 'guest';
      }),
    );
    expect(sides.size).toBe(2);
  });

  it('RV-08: 리매치하면 대기실로 돌아가 판을 처음 배치로 되돌린다', () => {
    const g = started({ blackPolicy: 'host' });
    expect(place(g.match, g.black, 'D3')).toEqual({ ok: true });
    g.match.leave(g.white);
    g.match.disconnect(g.black);
    // 흑은 끊긴 채 시간 초과가 이어지고, 백은 봇. 끝까지 간다
    g.scheduler.advance(10 * 60_000);
    expect(g.match.phase).toBe('GAME_OVER');
    g.match.reconnect(g.black);
    expect(g.match.handle(g.black, 'rematch', {})).toEqual({ ok: true });
    expect(g.match.phase).toBe('WAITING');
    expect(g.match.state.moveCount).toBe(0);
    expect(g.match.state.passCount).toBe(0);
    expect([...g.match.state.board].filter((c) => c !== 0)).toHaveLength(4);
    expect(g.match.state.players.get(g.black)).toMatchObject({ color: '', autopilot: false });
  });
});

describe('리버시 방: 착수 (RV-03, RV-04, 7장)', () => {
  it('RT-02: 두면 끼인 돌을 뒤집고 모두에게 알린다', () => {
    const g = started({ blackPolicy: 'host' });
    expect(place(g.match, g.black, 'D3')).toEqual({ ok: true });
    expect(cell(g.match, 'D3')).toBe(reversi.BLACK);
    expect(cell(g.match, 'D4')).toBe(reversi.BLACK);
    expect(g.io.last('stone_placed')).toEqual({
      color: 'black',
      x: 3,
      y: 2,
      flipped: [{ x: 3, y: 3 }],
      moveNo: 1,
      isBot: false,
      isAuto: false,
    });
    expect(g.match.state.lastMove).toBe(reversi.indexOf({ x: 3, y: 2 }));
    expect(g.match.state.currentTurn).toBe(g.white);
  });

  it('RT-03: 뒤집을 돌이 없는 칸, 돌이 있는 칸, 판 밖은 INVALID_MOVE이고 판은 그대로', () => {
    const g = started({ blackPolicy: 'host' });
    const before = [...g.match.state.board];
    expect(place(g.match, g.black, 'A1')).toMatchObject({ code: 'INVALID_MOVE' });
    expect(place(g.match, g.black, 'D4')).toMatchObject({ code: 'INVALID_MOVE' });
    expect(g.match.handle(g.black, 'place', { x: 8, y: 0, turnId: g.match.state.turnId })).toMatchObject({
      code: 'INVALID_MOVE',
    });
    expect(g.match.handle(g.black, 'place', { x: '3', y: 2, turnId: g.match.state.turnId })).toMatchObject({
      code: 'INVALID_MOVE',
    });
    expect([...g.match.state.board]).toEqual(before);
    expect(g.match.state.currentTurn).toBe(g.black);
  });

  it('차례와 turnId를 검사한다', () => {
    const g = started({ blackPolicy: 'host' });
    expect(place(g.match, g.white, 'C5')).toMatchObject({ code: 'NOT_YOUR_TURN' });
    expect(g.match.handle(g.black, 'place', { x: 3, y: 2, turnId: 'old' })).toMatchObject({
      code: 'STALE_TURN',
    });
  });
});

describe('리버시 방: 시간 초과 (RV-12, RV-14)', () => {
  it('RT-06: 시간 초과면 대신 두고, 2번 연속이면 봇이 진행, 직접 두면 돌려받는다', () => {
    const g = started({ blackPolicy: 'host', turnSeconds: 15 });
    g.scheduler.advance(15_000 + 1);
    expect(g.match.phase).toBe('PLAYING');
    expect(g.io.last('stone_placed')).toMatchObject({ color: 'black', isAuto: true, isBot: false });
    expect(g.match.state.players.get(g.black)?.autopilot).toBe(false);
    // 백이 둔다
    const white = reversi.reversiBotMove(currentBoard(g.match), 'white')!;
    expect(place(g.match, g.white, reversi.coordLabel(white))).toEqual({ ok: true });
    // 흑 두 번째 시간 초과 → autopilot
    g.scheduler.advance(15_000 + 1);
    expect(g.match.state.players.get(g.black)?.autopilot).toBe(true);
    // 백이 두면 흑은 봇 지연 뒤 자동으로 둔다
    const w2 = reversi.reversiBotMove(currentBoard(g.match), 'white')!;
    expect(place(g.match, g.white, reversi.coordLabel(w2))).toEqual({ ok: true });
    g.scheduler.advance(FAST_TIMING.botDelayMaxMs);
    expect(g.io.last('stone_placed')).toMatchObject({ color: 'black', isAuto: true });
    // 다시 흑 차례가 오면 직접 두어 돌려받는다
    const w3 = reversi.reversiBotMove(currentBoard(g.match), 'white')!;
    expect(place(g.match, g.white, reversi.coordLabel(w3))).toEqual({ ok: true });
    const b = reversi.legalMoves(currentBoard(g.match), 'black')[0]!;
    expect(place(g.match, g.black, reversi.coordLabel(b))).toEqual({ ok: true });
    expect(g.match.state.players.get(g.black)?.autopilot).toBe(false);
    expect(g.io.last('stone_placed')).toMatchObject({ color: 'black', isAuto: false });
  });

  it('RV-11: 끊겨도 시간은 흐르고, 대신 둔다 (시간패 아님)', () => {
    const g = started({ blackPolicy: 'host', turnSeconds: 15 });
    g.match.disconnect(g.black);
    expect(g.io.last('player_replaced')).toMatchObject({ playerId: g.black, reason: 'disconnected' });
    g.scheduler.advance(15_000 + 1);
    expect(g.match.phase).toBe('PLAYING');
    expect(g.io.last('stone_placed')).toMatchObject({ color: 'black', isAuto: true });
  });
});

describe('리버시 방: 퇴장 (RV-11)', () => {
  it('게임 중 나가면 봇이 이어서 두고, 상대에게 알린다. 봇 자리는 시간 초과가 없다', () => {
    const g = started({ blackPolicy: 'host' });
    place(g.match, g.black, 'D3');
    g.match.leave(g.white);
    expect(g.io.last('player_replaced')).toMatchObject({ playerId: g.white, reason: 'left' });
    expect(g.match.state.players.get(g.white)).toMatchObject({ replaced: true, isBot: true });
    g.scheduler.advance(FAST_TIMING.botDelayMaxMs);
    expect(g.match.state.moveCount).toBe(2);
    expect(g.io.last('stone_placed')).toMatchObject({ color: 'white', isBot: true, isAuto: false });
  });

  it('사람이 모두 나가면 방을 닫는다', () => {
    const g = started();
    g.match.leave(g.host);
    expect(g.io.abandoned).toBe(0);
    g.match.leave(g.guest);
    expect(g.io.abandoned).toBe(1);
  });
});

describe('리버시 방: 끝까지 (RV-05~RV-07, 8장)', () => {
  it('RT-04, RT-05: 넘김은 서버가 알리고, 둘 다 못 두면 돌 수로 끝내고 기록한다', () => {
    let sawPass = false;
    for (let seed = 1; seed <= 40; seed += 1) {
      const g = vsBot({ blackPolicy: 'host', turnSeconds: 15 }, seed);
      // 방장은 두지 않아 대신 두기 → autopilot으로 끝까지 간다
      g.scheduler.advance(30 * 60_000);
      expect(g.match.phase, `seed ${seed}`).toBe('GAME_OVER');
      const board = currentBoard(g.match);
      expect(reversi.hasLegalMove(board, 'black') || reversi.hasLegalMove(board, 'white')).toBe(false);
      const { black, white } = reversi.countStones(board);
      const over = g.io.last('game_over')!;
      expect(over).toMatchObject({ black, white });
      const winner = reversi.winnerOf(board);
      expect(over.result).toBe(winner ? 'count' : 'draw');
      expect(g.match.state.winnerId).toBe(
        winner ? [...g.match.state.players.values()].find((p) => p.color === winner)!.id : '',
      );
      const passes = g.io.all('turn_passed');
      expect(passes).toHaveLength(g.match.state.passCount);
      if (passes.length > 0) sawPass = true;

      const record = g.io.records[0]!;
      expect(record).toMatchObject({ black, white, passCount: passes.length });
      expect(record.moves).toHaveLength(g.match.state.moveCount);
      const summary = toReversiSummary(record);
      expect(summary).toMatchObject({ gameType: 'reversi', endReason: over.result });
      expect(summary.summary).toMatchObject({
        black,
        white,
        moveCount: record.moves.length,
        passCount: passes.length,
        hasBot: true,
      });
      expect(summary.summary.autoMoveCount).toBeGreaterThan(0);
    }
    expect(sawPass).toBe(true);
  });
});

describe('리버시 방: 대기실', () => {
  it('2명까지 앉고, 그 뒤는 ROOM_FULL. 옵션은 방장만', () => {
    const { match } = setup();
    const host = joinOk(match, 'guest-host-01', '방장');
    const guest = joinOk(match, 'guest-guest-01', '손님');
    expect(match.join('guest-third-01', '셋째')).toEqual({ ok: false, code: 'ROOM_FULL' });
    expect(match.handle(guest, 'set_options', { options: { turnSeconds: 15 } })).toMatchObject({
      code: 'NOT_HOST',
    });
    expect(match.handle(host, 'set_options', { options: { turnSeconds: 45 } })).toMatchObject({
      code: 'INVALID_OPTIONS',
    });
    expect(match.handle(host, 'set_options', { options: { turnSeconds: 60, blackPolicy: 'guest' } })).toEqual(
      {
        ok: true,
      },
    );
    expect(match.state.options).toMatchObject({ turnSeconds: 60, blackPolicy: 'guest' });
  });
});

function currentBoard(match: ReversiMatch): reversi.Cell[] {
  return [...match.state.board] as reversi.Cell[];
}
