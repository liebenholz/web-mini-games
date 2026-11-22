import { DEFAULT_ROOM_OPTIONS } from '@wmg/rules';
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../src/framework/rng.js';
import { VirtualScheduler } from '../src/framework/scheduler.js';
import { LiarsDiceMatch } from '../src/games/liars-dice/LiarsDiceMatch.js';
import { FAST_TIMING, FakeIO } from './helpers.js';

describe('M2 완료 기준: 봇 1,000판 연속 실행', () => {
  it('예외 0건, 모든 판이 GAME_OVER, 남은 타이머 0', () => {
    let finished = 0;
    for (let game = 0; game < 1000; game += 1) {
      const io = new FakeIO();
      const scheduler = new VirtualScheduler();
      const maxPlayers = 2 + (game % 5);
      const match = new LiarsDiceMatch(
        'SOAK01',
        { ...DEFAULT_ROOM_OPTIONS, maxPlayers, startingDice: 3 + (game % 3) },
        { io, scheduler, rng: createSeededRng(game + 1), timing: FAST_TIMING },
      );
      // 방장 1명 + 빈자리를 채운 봇. 방장은 입력하지 않는다
      const host = match.join(`host-${game}`, '방장');
      if (!host.ok) throw new Error('join failed');
      expect(match.handle(host.playerId, 'start_game', {})).toEqual({ ok: true });
      // 방장은 무입력 → 2턴 타임아웃 후 봇 대리 (S-07)
      scheduler.runAll();
      expect(match.phase).toBe('GAME_OVER');
      expect(io.records).toHaveLength(1);
      expect(scheduler.pending).toBe(0);
      match.dispose();
      finished += 1;
    }
    expect(finished).toBe(1000);
  });
});
