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
