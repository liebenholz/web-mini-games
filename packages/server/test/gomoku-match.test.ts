import { gomoku } from '@wmg/rules';
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../src/framework/rng.js';
import { VirtualScheduler } from '../src/framework/scheduler.js';
import { GomokuMatch, type GomokuIO, type GomokuRecord } from '../src/games/gomoku/GomokuMatch.js';
import { FAST_TIMING } from './helpers.js';

class FakeGomokuIO implements GomokuIO {
  readonly broadcasts: { type: string; payload: Record<string, unknown> }[] = [];
  readonly records: GomokuRecord[] = [];
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
  onFinished(record: GomokuRecord): void {
    this.records.push(record);
  }
  last(type: string) {
    return [...this.broadcasts].reverse().find((b) => b.type === type)?.payload;
  }
}

function setup(options: Partial<gomoku.GomokuRoomOptions> = {}, seed = 7) {
  const io = new FakeGomokuIO();
  const scheduler = new VirtualScheduler();
  const match = new GomokuMatch(
    'GOMOKU',
    { ...gomoku.DEFAULT_GOMOKU_OPTIONS, fillWithBots: false, ...options },
    { io, scheduler, rng: createSeededRng(seed), timing: FAST_TIMING },
  );
  return { io, scheduler, match };
}

function joinOk(match: GomokuMatch, guestId: string, nickname: string): string {
  const r = match.join(guestId, nickname);
  if (!r.ok) throw new Error(`join failed: ${r.code}`);
  return r.playerId;
}

/** 방장 + 손님 2명을 앉히고 시작해서 대국까지 */
function started(options: Partial<gomoku.GomokuRoomOptions> = {}, seed = 7) {
  const ctx = setup(options, seed);
  const host = joinOk(ctx.match, 'guest-host-01', '방장');
  const guest = joinOk(ctx.match, 'guest-guest-01', '손님');
  ctx.match.handle(guest, 'set_ready', { ready: true });
  expect(ctx.match.handle(host, 'start_game', {})).toEqual({ ok: true });
  expect(ctx.match.phase).toBe('STARTING');
  ctx.scheduler.advance(FAST_TIMING.startCountdownMs);
  expect(ctx.match.phase).toBe('PLAYING');
  const color = (id: string) => ctx.match.state.players.get(id)?.color;
  const black = color(host) === 'black' ? host : guest;
  const white = black === host ? guest : host;
  return { ...ctx, host, guest, black, white };
}

function place(match: GomokuMatch, playerId: string, label: string) {
  const p = gomoku.parseCoord(label)!;
  return match.handle(playerId, 'place', { x: p.x, y: p.y, turnId: match.state.turnId });
}

/** 흑과 백을 번갈아 둔다 */
function play(match: GomokuMatch, black: string, white: string, moves: string[]) {
  moves.forEach((label, i) =>
    expect(place(match, i % 2 === 0 ? black : white, label), label).toEqual({ ok: true }),
  );
}

describe('오목 방: 흑 정하기 (G-02, G-13)', () => {
  it('GT-14: 방장 / 상대 / 무작위 옵션대로 흑을 정하고, 흑부터 둔다', () => {
    const a = started({ blackPolicy: 'host' });
    expect(a.black).toBe(a.host);
    expect(a.match.state.currentTurn).toBe(a.host);

    const b = started({ blackPolicy: 'guest' });
    expect(b.black).toBe(b.guest);
    expect(b.match.state.currentTurn).toBe(b.guest);

    const blacks = new Set(
      [1, 2, 3, 4, 5, 6].map((seed) =>
        started({ blackPolicy: 'random' }, seed).black === started({ blackPolicy: 'random' }, seed).host
          ? 'host'
          : 'guest',
      ),
    );
    expect(blacks.size).toBe(2);
  });

  it('리매치하면 같은 방 대기실로 돌아가고, 다시 시작하면 옵션을 다시 적용한다', () => {
    const g = started({ blackPolicy: 'guest' });
    expect(g.match.handle(g.black, 'place', {})).toMatchObject({ code: 'STALE_TURN' });
    g.scheduler.advance(30_000 + 1); // 흑 시간패
    expect(g.match.phase).toBe('GAME_OVER');
    expect(g.match.handle(g.host, 'set_options', { options: { blackPolicy: 'host' } })).toMatchObject({
      code: 'INVALID_STATE',
    });
    expect(g.match.handle(g.host, 'rematch', {})).toEqual({ ok: true });
    expect(g.match.phase).toBe('WAITING');
    expect(g.match.state.moveCount).toBe(0);
    expect([...g.match.state.board].every((c) => c === 0)).toBe(true);
    expect(g.match.handle(g.host, 'set_options', { options: { blackPolicy: 'host' } })).toEqual({ ok: true });
    g.match.handle(g.guest, 'set_ready', { ready: true });
    g.match.handle(g.host, 'start_game', {});
    g.scheduler.advance(FAST_TIMING.startCountdownMs);
    expect(g.match.state.players.get(g.host)?.color).toBe('black');
  });
});

describe('오목 방: 착수 (G-03, G-07, GE-01~GE-05)', () => {
  it('차례, turnId, 빈칸, 판 범위를 검사한다', () => {
    const g = started({ blackPolicy: 'host' });
    expect(place(g.match, g.white, 'H8')).toMatchObject({ code: 'NOT_YOUR_TURN' });
    expect(g.match.handle(g.black, 'place', { x: 7, y: 7, turnId: 'old' })).toMatchObject({
      code: 'STALE_TURN',
    });
    expect(g.match.handle(g.black, 'place', { x: 15, y: 7, turnId: g.match.state.turnId })).toMatchObject({
      code: 'INVALID_MOVE',
    });
    expect(g.match.handle(g.black, 'place', { x: '7', y: 7, turnId: g.match.state.turnId })).toMatchObject({
      code: 'INVALID_MOVE',
    });
    expect(place(g.match, g.black, 'H8')).toEqual({ ok: true });
    expect(g.match.state.board[gomoku.indexOf(7, 7)]).toBe(gomoku.BLACK);
    expect(g.match.state.lastMove).toBe(gomoku.indexOf(7, 7));
    expect(g.io.last('stone_placed')).toMatchObject({ color: 'black', x: 7, y: 7, moveNo: 1, isBot: false });
    expect(place(g.match, g.white, 'H8')).toMatchObject({ code: 'OCCUPIED' });
    // 같은 턴에 두 번 보내면 두 번째는 STALE_TURN (GE-05)
    const turnId = g.match.state.turnId;
    expect(g.match.handle(g.white, 'place', { x: 0, y: 0, turnId })).toEqual({ ok: true });
    expect(g.match.handle(g.white, 'place', { x: 1, y: 0, turnId })).toMatchObject({ code: 'NOT_YOUR_TURN' });
  });

  it('흑의 3-3은 기본(렌주)에서 FORBIDDEN_MOVE, 자유 오목이면 둘 수 있다', () => {
    const renju = started({ blackPolicy: 'host' });
    play(renju.match, renju.black, renju.white, ['H9', 'A1', 'H10', 'A3', 'I8', 'A5', 'J8', 'A7']);
    expect(place(renju.match, renju.black, 'H8')).toMatchObject({ code: 'FORBIDDEN_MOVE' });

    const free = started({
      blackPolicy: 'host',
      forbidDoubleThree: false,
      forbidDoubleFour: false,
      forbidOverline: false,
    });
    play(free.match, free.black, free.white, ['H9', 'A1', 'H10', 'A3', 'I8', 'A5', 'J8', 'A7']);
    expect(place(free.match, free.black, 'H8')).toEqual({ ok: true });
  });
});

describe('오목 방: 끝 (G-04, G-12, G-11)', () => {
  it('GT-01: 다섯을 이으면 승리, 결과와 승리한 줄을 알리고 기록한다', () => {
    const g = started({ blackPolicy: 'host' });
    play(g.match, g.black, g.white, ['D8', 'D1', 'E8', 'E1', 'F8', 'F1', 'G8', 'G1', 'H8']);
    expect(g.match.phase).toBe('GAME_OVER');
    expect(g.match.state.result).toBe('five');
    expect(g.match.state.winnerId).toBe(g.black);
    expect([...g.match.state.winLine]).toHaveLength(5);
    expect(g.io.last('game_over')).toMatchObject({ result: 'five', winnerId: g.black });
    expect(g.io.records[0]).toMatchObject({ result: 'five', winnerColor: 'black' });
    expect(g.io.records[0]?.moves).toHaveLength(9);
    expect(place(g.match, g.white, 'A9')).toMatchObject({ code: 'INVALID_STATE' });
  });

  it('GT-09: 마감까지 두지 않으면 차례인 사람이 시간패', () => {
    const g = started({ blackPolicy: 'host', turnSeconds: 15 });
    place(g.match, g.black, 'H8');
    g.scheduler.advance(15_000 - 1);
    expect(g.match.phase).toBe('PLAYING');
    g.scheduler.advance(2);
    expect(g.match.state.result).toBe('timeout');
    expect(g.match.state.winnerId).toBe(g.black);
  });
});

describe('오목 방: 퇴장과 연결 끊김 (G-22, G-23)', () => {
  it('GT-10: 게임 중 나가면 봇이 이어서 두고, 상대에게 알린다', () => {
    const g = started({ blackPolicy: 'host' });
    place(g.match, g.black, 'H8');
    g.match.leave(g.white); // 백 차례에 나감
    expect(g.io.last('player_replaced')).toMatchObject({ playerId: g.white, reason: 'left' });
    expect(g.match.state.players.get(g.white)).toMatchObject({ replaced: true, isBot: true });
    g.scheduler.advance(FAST_TIMING.botDelayMaxMs);
    expect(g.match.state.moveCount).toBe(2);
    expect(g.io.last('stone_placed')).toMatchObject({ color: 'white', isBot: true });
    // 봇 자리는 시간패가 없다 (G-25): 흑이 두면 봇이 다시 둔다
    place(g.match, g.black, 'A1');
    g.scheduler.advance(FAST_TIMING.botDelayMaxMs);
    expect(g.match.state.moveCount).toBe(4);
  });

  it('GT-11: 끊겨도 시간은 흐르고 마감까지 안 돌아오면 시간패, 상대에게 끊김과 복귀를 알린다', () => {
    const g = started({ blackPolicy: 'host', turnSeconds: 15 });
    g.match.disconnect(g.black);
    expect(g.io.last('player_replaced')).toMatchObject({ playerId: g.black, reason: 'disconnected' });
    expect(g.match.state.players.get(g.black)?.connected).toBe(false);
    g.match.reconnect(g.black);
    expect(g.io.last('player_replaced')).toMatchObject({ playerId: g.black, reason: 'returned' });

    g.match.disconnect(g.black);
    g.scheduler.advance(15_000 + 1);
    expect(g.match.state.result).toBe('timeout');
    expect(g.match.state.winnerId).toBe(g.white);
  });

  it('ST-08: 게임 중 나가 봇이 이어받은 자리는 판 기록에 replaced로 남는다', () => {
    const g = started({ blackPolicy: 'host', turnSeconds: 15 });
    place(g.match, g.black, 'H8');
    g.match.leave(g.white);
    g.scheduler.advance(FAST_TIMING.botDelayMaxMs);
    g.match.disconnect(g.black);
    g.scheduler.advance(15_000 + 1);
    expect(g.match.state.result).toBe('timeout');
    const players = g.io.records[0]?.players ?? [];
    expect(players.find((p) => p.color === 'white')).toMatchObject({ isBot: false, replaced: true });
    expect(players.find((p) => p.color === 'black')).toMatchObject({ replaced: false });
  });

  it('사람이 모두 나가면 방을 닫는다 (GE-06)', () => {
    const g = started();
    g.match.leave(g.host);
    expect(g.io.abandoned).toBe(0);
    g.match.leave(g.guest);
    expect(g.io.abandoned).toBe(1);
  });
});

describe('오목 방: 대기실', () => {
  it('2명까지 앉고, 그 뒤는 ROOM_FULL. 게임 중 입장은 관전자 (GE-07)', () => {
    const { match, scheduler } = setup({ fillWithBots: true });
    const host = joinOk(match, 'guest-host-01', '방장');
    const guest = joinOk(match, 'guest-guest-01', '손님');
    expect(match.join('guest-third-01', '셋째')).toEqual({ ok: false, code: 'ROOM_FULL' });
    match.handle(guest, 'set_ready', { ready: true });
    expect(match.handle(host, 'start_game', {})).toEqual({ ok: true });
    expect(match.handle(host, 'start_game', {})).toMatchObject({ code: 'INVALID_STATE' });
    scheduler.advance(FAST_TIMING.startCountdownMs);
    expect(match.join('guest-third-01', '셋째')).toMatchObject({ ok: true, role: 'spectator' });
  });

  it('혼자 시작하면 빈자리를 봇으로 채우고, 끄면 NOT_ENOUGH_PLAYERS', () => {
    const off = setup({ fillWithBots: false });
    const a = joinOk(off.match, 'guest-host-01', '방장');
    expect(off.match.handle(a, 'start_game', {})).toMatchObject({ code: 'NOT_ENOUGH_PLAYERS' });

    const on = setup({ fillWithBots: true, blackPolicy: 'guest' });
    const b = joinOk(on.match, 'guest-host-01', '방장');
    expect(on.match.handle(b, 'start_game', {})).toEqual({ ok: true });
    on.scheduler.advance(FAST_TIMING.startCountdownMs);
    // 봇이 흑이라 먼저 둔다
    on.scheduler.advance(FAST_TIMING.botDelayMaxMs);
    expect(on.match.state.moveCount).toBe(1);
    expect(on.match.state.board[gomoku.indexOf(7, 7)]).toBe(gomoku.BLACK);
  });

  it('준비하지 않은 사람이 있으면 시작할 수 없고, 옵션과 봇은 방장만', () => {
    const { match } = setup();
    const host = joinOk(match, 'guest-host-01', '방장');
    const guest = joinOk(match, 'guest-guest-01', '손님');
    expect(match.handle(host, 'start_game', {})).toMatchObject({ code: 'NOT_ALL_READY' });
    expect(match.handle(guest, 'set_options', { options: { forbidOverline: false } })).toMatchObject({
      code: 'NOT_HOST',
    });
    expect(match.handle(host, 'set_options', { options: { turnSeconds: 45 } })).toMatchObject({
      code: 'INVALID_OPTIONS',
    });
    expect(
      match.handle(host, 'set_options', { options: { forbidOverline: false, blackPolicy: 'guest' } }),
    ).toEqual({
      ok: true,
    });
    expect(match.state.options.forbidOverline).toBe(false);
    expect(match.state.options.blackPolicy).toBe('guest');
    expect(match.handle(host, 'add_bot', {})).toMatchObject({ code: 'ROOM_FULL' });
  });

  it('E-15: 추방한 사람은 다시 들어올 수 없다', () => {
    const { match, io } = setup();
    const host = joinOk(match, 'guest-host-01', '방장');
    const guest = joinOk(match, 'guest-guest-01', '손님');
    expect(match.handle(host, 'kick_player', { playerId: guest })).toEqual({ ok: true });
    expect(io.kicked).toEqual([guest]);
    expect(match.join('guest-guest-01', '손님')).toEqual({ ok: false, code: 'KICKED' });
  });
});
