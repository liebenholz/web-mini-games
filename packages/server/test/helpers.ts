import { DEFAULT_ROOM_OPTIONS, type RoomOptions } from '@wmg/rules';
import { createSeededRng } from '../src/framework/rng.js';
import { VirtualScheduler } from '../src/framework/scheduler.js';
import { LiarsDiceMatch, type MatchIO, type Timing } from '../src/games/liars-dice/LiarsDiceMatch.js';
import type { GameRecord } from '../src/persistence/types.js';

export interface Sent {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export class FakeIO implements MatchIO {
  readonly broadcasts: Sent[] = [];
  readonly direct = new Map<string, Sent[]>();
  readonly records: GameRecord[] = [];
  abandoned = 0;
  listed: boolean[] = [];

  broadcast(type: string, payload: object): void {
    this.broadcasts.push({ type, payload: payload as Record<string, unknown> });
  }
  sendTo(playerId: string, type: string, payload: object): void {
    const list = this.direct.get(playerId) ?? [];
    list.push({ type, payload: payload as Record<string, unknown> });
    this.direct.set(playerId, list);
  }
  onRecord(record: GameRecord): void {
    this.records.push(record);
  }
  onAbandoned(): void {
    this.abandoned += 1;
  }
  onListingChange(listed: boolean): void {
    this.listed.push(listed);
  }
  lastBroadcast(type: string): Sent | undefined {
    return [...this.broadcasts].reverse().find((s) => s.type === type);
  }
  received(playerId: string): Sent[] {
    return this.direct.get(playerId) ?? [];
  }
}

export const FAST_TIMING: Timing = {
  startCountdownMs: 3000,
  revealMs: 3000,
  botDelayMinMs: 1000,
  botDelayMaxMs: 3000,
  msPerTurnSecond: 1000,
};

export function setup(options: Partial<RoomOptions> = {}, seed = 1) {
  const io = new FakeIO();
  const scheduler = new VirtualScheduler();
  const rng = createSeededRng(seed);
  const match = new LiarsDiceMatch(
    'ABCDEF',
    { ...DEFAULT_ROOM_OPTIONS, ...options },
    {
      io,
      rng,
      scheduler,
      timing: FAST_TIMING,
    },
  );
  return { io, scheduler, match };
}

export function joinOk(match: LiarsDiceMatch, guestId: string, nickname: string): string {
  const r = match.join(guestId, nickname);
  if (!r.ok) throw new Error(`join failed: ${r.code}`);
  return r.playerId;
}

/** 사람 n명 방에서 게임을 시작하고 첫 턴(BIDDING)까지 진행한다 */
export function startHumans(n: number, options: Partial<RoomOptions> = {}, seed = 1) {
  const ctx = setup({ fillWithBots: false, ...options }, seed);
  const ids = Array.from({ length: n }, (_, i) => joinOk(ctx.match, `guest-${i}`, `사람${i}`));
  for (const id of ids.slice(1)) ctx.match.handle(id, 'set_ready', { ready: true });
  const r = ctx.match.handle(ids[0]!, 'start_game', {});
  if (!r.ok) throw new Error(`start failed: ${r.code}`);
  ctx.scheduler.advance(FAST_TIMING.startCountdownMs);
  return { ...ctx, ids };
}

export function currentTurn(match: LiarsDiceMatch): { playerId: string; turnId: string } {
  return { playerId: match.state.currentTurn, turnId: match.state.turnId };
}
