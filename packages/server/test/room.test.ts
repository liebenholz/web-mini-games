import { matchMaker } from '@colyseus/core';
import type { Room as SDKRoom } from '@colyseus/sdk';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameServer } from '../src/app.js';
import { createSeededRng } from '../src/framework/rng.js';
import { activeRooms, configureLiarsDice } from '../src/games/liars-dice/runtime.js';
import { MemoryRecorder } from '../src/persistence/types.js';

/** 통합 테스트용 짧은 시간: 턴 1초 = 10ms (15초 턴 = 150ms) */
const TEST_TIMING = {
  startCountdownMs: 30,
  revealMs: 30,
  botDelayMinMs: 5,
  botDelayMaxMs: 15,
  msPerTurnSecond: 10,
};
const ROOM = 'liars_dice';

let colyseus: ColyseusTestServer;
let recorder: MemoryRecorder;
let seed = 0;
let guest = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const newGuest = () => `guest-${(guest += 1).toString().padStart(8, '0')}`;

async function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await sleep(10);
  }
}

interface Spy {
  room: SDKRoom;
  messages: Array<{ type: string; payload: Record<string, unknown> }>;
  snapshots: string[];
  playerId: string;
}

function spy(room: SDKRoom): Spy {
  const s: Spy = { room, messages: [], snapshots: [], playerId: '' };
  room.onMessage('*', (type, payload) => {
    const p = payload as Record<string, unknown>;
    s.messages.push({ type: String(type), payload: p });
    if (type === 'welcome') s.playerId = String(p.playerId);
  });
  room.onStateChange((state) => s.snapshots.push(JSON.stringify((state as { toJSON(): unknown }).toJSON())));
  return s;
}

const has = (s: Spy, type: string) => s.messages.some((m) => m.type === type);
const options = (extra: Record<string, unknown> = {}) => ({ fillWithBots: false, turnSeconds: 15, ...extra });

beforeAll(async () => {
  colyseus = await boot(createGameServer({ config: { corsOrigins: [] } }));
});

beforeEach(async () => {
  await colyseus.cleanup();
  recorder = new MemoryRecorder();
  configureLiarsDice({
    recorder,
    timing: TEST_TIMING,
    reconnectSeconds: 1,
    createRng: () => createSeededRng((seed += 1)),
  });
});

afterAll(async () => {
  await colyseus.shutdown();
});

async function createRoom(extra: Record<string, unknown> = {}): Promise<Spy> {
  const room = await colyseus.sdk.create(ROOM, {
    guestId: newGuest(),
    nickname: '방장',
    options: options(extra),
  });
  const s = spy(room);
  await waitFor(() => s.playerId !== '');
  return s;
}

async function joinRoom(code: string, guestId = newGuest(), nickname = '참가자'): Promise<Spy> {
  const room = await colyseus.sdk.joinById(code, { guestId, nickname });
  const s = spy(room);
  await waitFor(() => s.playerId !== '');
  return s;
}

describe('LiarsDiceRoom 통합 (M2)', () => {
  it('방 코드: 6자리, 0/O/1/I 없음, roomId와 같다', async () => {
    const host = await createRoom();
    expect(host.room.roomId).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const state = host.room.state as { roomCode: string };
    await waitFor(() => state.roomCode !== '');
    expect(state.roomCode).toBe(host.room.roomId);
  });

  it('완료 기준: 봇 3명 방에서 GAME_OVER까지 진행되고 기록이 남는다', async () => {
    const host = await createRoom({ maxPlayers: 4, startingDice: 3 });
    for (let i = 0; i < 3; i += 1) host.room.send('add_bot', {});
    await sleep(50);
    host.room.send('start_game', {});
    await waitFor(() => has(host, 'game_over'), 20_000);
    const over = host.messages.find((m) => m.type === 'game_over')!.payload;
    expect((over.ranking as unknown[]).length).toBe(4);
    await waitFor(() => recorder.records.length === 1);
    expect(recorder.records[0]!.players.filter((p) => p.isBot)).toHaveLength(3);
  });

  it('TC-08, TC-09: 다른 클라이언트가 받는 메시지와 상태에 공개 전 타인 주사위가 없다 (관전자 포함)', async () => {
    const a = await createRoom({ startingDice: 3 });
    const b = await joinRoom(a.room.roomId);
    const c = await joinRoom(a.room.roomId);
    b.room.send('set_ready', { ready: true });
    c.room.send('set_ready', { ready: true });
    await sleep(30);
    a.room.send('start_game', {});
    await waitFor(() => has(a, 'your_dice'));
    const watcher = await joinRoom(a.room.roomId, newGuest(), '관전자');
    expect(watcher.messages.find((m) => m.type === 'welcome')?.payload.role).toBe('spectator');
    await waitFor(() => has(a, 'game_over'), 30_000);
    await sleep(50);

    for (const s of [a, b, c, watcher]) {
      for (const snap of s.snapshots) expect(snap).not.toMatch(/"dice"/);
      for (const m of s.messages) {
        if (m.type === 'reveal' || m.type === 'your_dice') continue;
        expect(JSON.stringify(m.payload)).not.toMatch(/"dice"/);
      }
    }
    expect(watcher.messages.filter((m) => m.type === 'your_dice')).toHaveLength(0);
    // 각자 받은 your_dice는 그 라운드 공개 결과의 자기 주사위와 같다 (남의 것이 아님)
    for (const s of [a, b, c]) {
      for (const d of s.messages.filter((m) => m.type === 'your_dice')) {
        const reveal = s.messages.find((m) => m.type === 'reveal' && m.payload.roundNo === d.payload.roundNo);
        if (!reveal) continue;
        const mine = (reveal.payload.dice as Array<{ playerId: string; dice: number[] }>).find(
          (x) => x.playerId === s.playerId,
        );
        expect(mine?.dice).toEqual(d.payload.dice);
      }
    }
  });

  it('TC-10, TC-12: 타임아웃 자동 선언(is_auto), 이중 전송은 STALE_TURN', async () => {
    const a = await createRoom();
    const b = await joinRoom(a.room.roomId);
    b.room.send('set_ready', { ready: true });
    await sleep(30);
    a.room.send('start_game', {});
    await waitFor(() => has(a, 'turn_start'));
    const turn = a.messages.find((m) => m.type === 'turn_start')!.payload;
    const first = turn.playerId === a.playerId ? a : b;
    first.room.send('bid', { quantity: 3, face: 4, turnId: turn.turnId });
    first.room.send('bid', { quantity: 3, face: 5, turnId: turn.turnId });
    await waitFor(() => first.messages.some((m) => m.type === 'error'));
    expect(first.messages.find((m) => m.type === 'error')?.payload.code).toBe('STALE_TURN');
    // 상대는 무입력 → 150ms 후 (3, 5) 자동 선언
    await waitFor(() => a.messages.filter((m) => m.type === 'bid_made').length >= 2);
    const bids = a.messages.filter((m) => m.type === 'bid_made').map((m) => m.payload);
    expect(bids[0]).toMatchObject({ quantity: 3, face: 4, isAuto: false });
    expect(bids[1]).toMatchObject({ quantity: 3, face: 5, isAuto: true });
  });

  it('TC-11: 마감 직후 도착한 입력은 STALE_TURN', async () => {
    const a = await createRoom();
    const b = await joinRoom(a.room.roomId);
    b.room.send('set_ready', { ready: true });
    await sleep(30);
    a.room.send('start_game', {});
    await waitFor(() => has(a, 'turn_start'));
    const turn = a.messages.find((m) => m.type === 'turn_start')!.payload;
    const mover = turn.playerId === a.playerId ? a : b;
    await waitFor(() => mover.messages.some((m) => m.type === 'bid_made'));
    mover.room.send('bid', { quantity: 9, face: 6, turnId: turn.turnId });
    await waitFor(() => mover.messages.some((m) => m.type === 'error'));
    expect(mover.messages.find((m) => m.type === 'error')?.payload.code).toBe('STALE_TURN');
  });

  it('TC-13: 연결이 끊겼다 돌아오면 자리 유지, your_dice 재전송', async () => {
    const a = await createRoom({ turnSeconds: 60 });
    const b = await joinRoom(a.room.roomId);
    b.room.send('set_ready', { ready: true });
    await sleep(30);
    a.room.send('start_game', {});
    await waitFor(() => has(b, 'your_dice'));
    const before = b.messages.filter((m) => m.type === 'your_dice').length;
    b.room.reconnection.minUptime = 0;
    b.room.reconnection.minDelay = 10;
    let reconnected = false;
    b.room.onReconnect(() => (reconnected = true));
    void b.room.leave(false);
    await waitFor(() => reconnected, 5_000);
    await waitFor(() => b.messages.filter((m) => m.type === 'your_dice').length > before);
    const state = b.room.state as { players: Map<string, { connected: boolean; isBot: boolean }> };
    await waitFor(() => state.players.get(b.playerId)?.connected === true);
    expect(state.players.get(b.playerId)?.isBot).toBe(false);
  });

  it('TC-14: 탭을 닫고 재접속 시간이 지나면 봇이 이어서 플레이', async () => {
    const a = await createRoom({ turnSeconds: 60 });
    const b = await joinRoom(a.room.roomId);
    b.room.send('set_ready', { ready: true });
    await sleep(30);
    a.room.send('start_game', {});
    await waitFor(() => has(a, 'turn_start'));
    b.room.reconnection.enabled = false;
    const bId = b.playerId;
    void b.room.leave(false);
    const state = a.room.state as { players: Map<string, { connected: boolean; isBot: boolean }> };
    await waitFor(() => state.players.get(bId)?.connected === false);
    await waitFor(() => state.players.get(bId)?.isBot === true, 5_000);
    // 봇이 b의 차례에 행동한다
    await waitFor(() => a.messages.some((m) => m.type === 'bid_made' && m.payload.playerId === bId), 10_000);
  });

  it('E-13: 같은 게스트로 두 번째 탭이 들어오면 이전 연결을 끊는다', async () => {
    const guestId = newGuest();
    const host = await colyseus.sdk.create(ROOM, { guestId, nickname: '방장', options: options() });
    const first = spy(host);
    await waitFor(() => first.playerId !== '');
    let leftCode = 0;
    host.onLeave((code) => (leftCode = code));
    const second = await joinRoom(host.roomId, guestId, '방장');
    expect(second.playerId).toBe(first.playerId);
    await waitFor(() => leftCode !== 0);
    expect(leftCode).toBe(4001);
    expect(first.messages.find((m) => m.type === 'error')?.payload.code).toBe('DUPLICATE_SESSION');
  });

  it('E-15: 내보낸 참가자는 KICKED(4003)로 연결이 닫히고 같은 방에 다시 못 들어온다', async () => {
    const host = await createRoom();
    const guestId = newGuest();
    const guest = await joinRoom(host.room.roomId, guestId, '민준');
    let leftCode = 0;
    guest.room.onLeave((code) => (leftCode = code));
    host.room.send('kick_player', { playerId: guest.playerId });
    await waitFor(() => leftCode !== 0);
    expect(leftCode).toBe(4003);
    expect(guest.messages.find((m) => m.type === 'error')?.payload.code).toBe('KICKED');
    const state = host.room.state as { players: Map<string, unknown> };
    await waitFor(() => !state.players.has(guest.playerId));
    await expect(joinRoom(host.room.roomId, guestId, '민준')).rejects.toThrow(/KICKED/);
    await joinRoom(host.room.roomId); // 다른 사람은 들어올 수 있다
  });

  it('E-12: 없는 방 코드, 가득 찬 방은 거부', async () => {
    await expect(
      colyseus.sdk.joinById('ZZZZZZ', { guestId: newGuest(), nickname: '누구' }),
    ).rejects.toThrow();
    const host = await createRoom({ maxPlayers: 2 });
    await joinRoom(host.room.roomId);
    await expect(joinRoom(host.room.roomId)).rejects.toThrow(/ROOM_FULL/);
  });

  it('입력 검증: 잘못된 게스트 ID, 닉네임, 옵션은 입장 거부', async () => {
    await expect(colyseus.sdk.create(ROOM, { guestId: 'x', nickname: '방장' })).rejects.toThrow(
      /INVALID_MESSAGE/,
    );
    await expect(colyseus.sdk.create(ROOM, { guestId: newGuest(), nickname: 'a' })).rejects.toThrow(
      /INVALID_NICKNAME/,
    );
    await expect(
      colyseus.sdk.create(ROOM, { guestId: newGuest(), nickname: '방장', options: { maxPlayers: 9 } }),
    ).rejects.toThrow(/INVALID_OPTIONS/);
  });

  it('E-14: 초당 10회를 넘는 요청은 무시하고 RATE_LIMITED를 한 번 알린다', async () => {
    const host = await createRoom();
    for (let i = 0; i < 15; i += 1) host.room.send('set_ready', { ready: i % 2 === 0 });
    await waitFor(() => host.messages.some((m) => m.type === 'error'));
    await sleep(50);
    const errors = host.messages.filter((m) => m.type === 'error');
    expect(errors.map((e) => e.payload.code)).toEqual(['RATE_LIMITED']);
  });

  it('/healthz가 응답한다', async () => {
    const res = await colyseus.http.get('/healthz');
    expect(res.statusCode).toBe(200);
    expect((res.data as { status: string }).status).toBe('ok');
  });

  it('/healthz는 HEAD 요청에도 200이다 (외부 감시 서비스 무료 플랜이 HEAD로만 확인한다)', async () => {
    const res = await fetch('http://localhost:2568/healthz', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('완료 기준: 끝난 방은 메모리에 남지 않는다 (20판 연속)', async () => {
    for (let i = 0; i < 20; i += 1) {
      const host = await createRoom({ maxPlayers: 3, startingDice: 3, fillWithBots: true });
      host.room.send('start_game', {});
      await waitFor(() => has(host, 'game_over'), 20_000);
      await host.room.leave();
    }
    await waitFor(() => activeRooms.size === 0);
    await waitFor(() => matchMaker.stats.local.roomCount === 0);
    expect(recorder.records).toHaveLength(20);
  });
});

describe('GomokuRoom 통합 (Phase 2 M2)', () => {
  async function createGomoku(extra: Record<string, unknown> = {}) {
    const room = await colyseus.sdk.create('gomoku', {
      guestId: newGuest(),
      nickname: '방장',
      options: { fillWithBots: false, turnSeconds: 15, ...extra },
    });
    const s = spy(room);
    await waitFor(() => s.playerId !== '');
    return s;
  }

  it('방 코드는 거짓말쟁이 주사위 방과 같은 형식이고 겹치지 않는다', async () => {
    const dice = await createRoom();
    const board = await createGomoku();
    expect(board.room.roomId).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(board.room.roomId).not.toBe(dice.room.roomId);
    expect(board.room.name).toBe('gomoku');
  });

  it('두 사람이 들어와 시작하고, 착수가 판에 반영되며, 다섯을 이으면 끝난다', async () => {
    const host = await createGomoku({ blackPolicy: 'host' });
    const guestSpy = await joinRoom(host.room.roomId, newGuest(), '손님');
    guestSpy.room.send('set_ready', { ready: true });
    await sleep(50);
    host.room.send('start_game', {});
    const state = host.room.state as {
      phase: string;
      turnId: string;
      currentTurn: string;
      board: number[];
      result: string;
    };
    await waitFor(() => state.phase === 'PLAYING');
    expect(state.currentTurn).toBe(host.playerId);

    const moves: Array<[Spy, number, number]> = [
      [host, 3, 7],
      [guestSpy, 3, 0],
      [host, 4, 7],
      [guestSpy, 4, 0],
      [host, 5, 7],
      [guestSpy, 5, 0],
      [host, 6, 7],
      [guestSpy, 6, 0],
      [host, 7, 7],
    ];
    for (const [who, x, y] of moves) {
      const turnId = state.turnId;
      who.room.send('place', { x, y, turnId });
      await waitFor(() => state.turnId !== turnId || state.phase === 'GAME_OVER');
    }
    await waitFor(() => state.phase === 'GAME_OVER');
    expect(state.result).toBe('five');
    expect(state.board[7 * 15 + 7]).toBe(1);
    expect(has(guestSpy, 'game_over')).toBe(true);
    // ADR 0002: 판 요약 한 줄 (수 순서는 저장하지 않음)
    await waitFor(() => recorder.summaries.length === 1);
    const summary = recorder.summaries[0]!;
    expect(summary.gameType).toBe('gomoku');
    expect(summary.endReason).toBe('five');
    expect(summary.summary).toMatchObject({
      result: 'five',
      winnerColor: 'black',
      moveCount: 9,
      hasBot: false,
    });
    expect(summary.players.map((p) => [p.seat, p.nickname, p.finalRank])).toEqual([
      [0, '방장', 1],
      [1, '손님', 2],
    ]);
  });

  it('G-22: 게임 중 나가면 상대가 player_replaced(left)를 받는다', async () => {
    const host = await createGomoku({ blackPolicy: 'host' });
    const guestSpy = await joinRoom(host.room.roomId, newGuest(), '손님');
    guestSpy.room.send('set_ready', { ready: true });
    await sleep(50);
    host.room.send('start_game', {});
    const state = host.room.state as { phase: string };
    await waitFor(() => state.phase === 'PLAYING');
    await guestSpy.room.leave();
    await waitFor(() =>
      host.messages.some((m) => m.type === 'player_replaced' && m.payload.reason === 'left'),
    );
  });
});

describe('ReversiRoom 통합 (reversi.md, ADR 0003 P5)', () => {
  it('두 사람이 들어와 시작하고, 착수가 판에 반영되며 뒤집힌 돌을 알린다', async () => {
    const room = await colyseus.sdk.create('reversi', {
      guestId: newGuest(),
      nickname: '방장',
      options: { fillWithBots: false, turnSeconds: 15, blackPolicy: 'host' },
    });
    const host = spy(room);
    await waitFor(() => host.playerId !== '');
    expect(host.room.name).toBe('reversi');
    const guestSpy = await joinRoom(host.room.roomId, newGuest(), '손님');
    guestSpy.room.send('set_ready', { ready: true });
    await sleep(50);
    host.room.send('start_game', {});
    const state = host.room.state as { phase: string; turnId: string; currentTurn: string; board: number[] };
    await waitFor(() => state.phase === 'PLAYING');
    expect(state.currentTurn).toBe(host.playerId);
    expect(state.board[3 * 8 + 3]).toBe(2);

    // D3 (x=3, y=2): D4가 뒤집힌다
    const turnId = state.turnId;
    guestSpy.room.send('place', { x: 3, y: 2, turnId });
    await waitFor(() => guestSpy.messages.some((m) => m.type === 'error'));
    host.room.send('place', { x: 0, y: 0, turnId });
    await waitFor(() => host.messages.some((m) => m.type === 'error' && m.payload.code === 'INVALID_MOVE'));
    host.room.send('place', { x: 3, y: 2, turnId });
    await waitFor(() => state.turnId !== turnId);
    expect(state.board[2 * 8 + 3]).toBe(1);
    expect(state.board[3 * 8 + 3]).toBe(1);
    expect(state.currentTurn).toBe(guestSpy.playerId);
    await waitFor(() => has(guestSpy, 'stone_placed'));
    expect(guestSpy.messages.find((m) => m.type === 'stone_placed')?.payload).toMatchObject({
      color: 'black',
      x: 3,
      y: 2,
      flipped: [{ x: 3, y: 3 }],
      moveNo: 1,
    });

    await guestSpy.room.leave();
    await waitFor(() =>
      host.messages.some((m) => m.type === 'player_replaced' && m.payload.reason === 'left'),
    );
  });
});

describe('OneCardRoom 통합 (Phase 2 M3)', () => {
  it('두 사람 + 봇 2명으로 시작하면 각자 자기 패 7장만 받고, 공유 상태에는 패가 없다 (C-40)', async () => {
    const room = await colyseus.sdk.create('one_card', {
      guestId: newGuest(),
      nickname: '방장',
      options: { maxPlayers: 4, turnSeconds: 15 },
    });
    const host = spy(room);
    await waitFor(() => host.playerId !== '');
    const guest = await joinRoom(host.room.roomId, newGuest(), '손님');
    expect(host.room.name).toBe('one_card');
    guest.room.send('set_ready', { ready: true });
    await sleep(50);
    host.room.send('start_game', {});
    await waitFor(() => has(host, 'your_hand') && has(guest, 'your_hand'), 10_000);
    const handOf = (s: Spy) => s.messages.find((m) => m.type === 'your_hand')!.payload.cards as string[];
    expect(handOf(host)).toHaveLength(7);
    expect(handOf(guest)).toHaveLength(7);
    expect(handOf(host).some((c) => handOf(guest).includes(c))).toBe(false);
    const state = JSON.stringify((host.room.state as { toJSON(): unknown }).toJSON());
    for (const card of handOf(guest)) expect(state).not.toContain(`"${card}"`);
  });
});

describe('BullsRoom 통합 (Phase 2 M4)', () => {
  it('두 사람이 비밀 숫자를 정하면 추측이 시작되고, 비밀 숫자는 본인에게만 간다 (B-20, B-21)', async () => {
    const room = await colyseus.sdk.create('bulls_and_cows', {
      guestId: newGuest(),
      nickname: '방장',
      options: { fillWithBots: false, turnSeconds: 30 },
    });
    const host = spy(room);
    await waitFor(() => host.playerId !== '');
    const guest = await joinRoom(host.room.roomId, newGuest(), '손님');
    expect(host.room.name).toBe('bulls_and_cows');
    guest.room.send('set_ready', { ready: true });
    await sleep(50);
    host.room.send('start_game', {});
    const state = host.room.state as { phase: string };
    await waitFor(() => state.phase === 'SECRET', 10_000);
    host.room.send('set_secret', { digits: '102' });
    guest.room.send('set_secret', { digits: '345' });
    await waitFor(() => state.phase === 'PLAYING');
    const secretOf = (s: Spy) =>
      s.messages.filter((m) => m.type === 'your_secret').map((m) => m.payload.digits);
    expect(secretOf(host)).toEqual(['102']);
    expect(secretOf(guest)).toEqual(['345']);
    const json = JSON.stringify((host.room.state as { toJSON(): unknown }).toJSON());
    // 비밀 숫자는 문자열 값 하나로 새어 나간다. 따옴표째 찾는다 (id·마감 시각에 우연히 345가 들어갈 수 있다)
    expect(json).not.toContain('"345"');
    expect(json).not.toContain('"102"');
    expect(has(host, 'turn_start')).toBe(true);
  });
});
