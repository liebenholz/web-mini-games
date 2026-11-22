import { describe, expect, it } from 'vitest';
import { replayGame } from '../src/persistence/replay.js';
import { startHumans } from './helpers.js';

function finishedRecord(seed: number) {
  const { scheduler, io } = startHumans(3, { startingDice: 3 }, seed);
  scheduler.runAll();
  return io.records[0]!;
}

describe('M3: 저장된 rounds와 bids로 판 재현', () => {
  it('기록이 룰과 일치하면 OK, 순위까지 같다', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const rec = finishedRecord(seed);
      const r = replayGame({
        startingDice: rec.options.startingDice,
        players: rec.players,
        rounds: rec.rounds,
        bids: rec.bids,
      });
      expect(r.problems).toEqual([]);
      expect(r.ok).toBe(true);
    }
  });

  it('조작된 판정은 잡아낸다', () => {
    const rec = finishedRecord(7);
    const rounds = rec.rounds.map((round, i) =>
      i === 0
        ? { ...round, result: { ...round.result, loserSeat: (round.result.loserSeat + 1) % 3 } }
        : round,
    );
    const r = replayGame({ startingDice: 3, players: rec.players, rounds, bids: rec.bids });
    expect(r.ok).toBe(false);
    expect(r.problems.join('\n')).toMatch(/result mismatch/);
  });

  it('조작된 선언 순서는 잡아낸다', () => {
    const rec = finishedRecord(8);
    const bids = rec.bids.map((b, i) => (i === 0 ? { ...b, seat: (b.seat + 1) % 3 } : b));
    const r = replayGame({ startingDice: 3, players: rec.players, rounds: rec.rounds, bids });
    expect(r.ok).toBe(false);
  });
});
