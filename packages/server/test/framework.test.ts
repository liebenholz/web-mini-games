import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/framework/rateLimiter.js';
import {
  assertTestSeedAllowed,
  createSeededRng,
  cryptoRng,
  TestSeedForbiddenError,
} from '../src/framework/rng.js';
import { TimerScheduler, VirtualScheduler } from '../src/framework/scheduler.js';
import { generateRoomCode } from '../src/framework/roomCode.js';
import { ROOM_CODE_ALPHABET } from '@wmg/rules';

describe('S-03/TC-15: crypto 난수 분포', () => {
  it('10만 회 굴림이 카이제곱 검정(자유도 5, α=0.001)에서 균등 분포를 기각하지 않는다', () => {
    const n = 100_000;
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < n; i += 1) counts[cryptoRng.int(6)]! += 1;
    const expected = n / 6;
    const chi2 = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
    expect(chi2).toBeLessThan(20.515);
  });
});

describe('S-04: 테스트 시드 주입', () => {
  it('NODE_ENV=production이면 ALLOW_TEST_SEED=true여도 거부', () => {
    expect(() => assertTestSeedAllowed({ NODE_ENV: 'production', ALLOW_TEST_SEED: 'true' })).toThrow(
      TestSeedForbiddenError,
    );
  });
  it('ALLOW_TEST_SEED가 true가 아니면 거부 (기본 OFF)', () => {
    expect(() => assertTestSeedAllowed({ NODE_ENV: 'development' })).toThrow(TestSeedForbiddenError);
    expect(() => assertTestSeedAllowed({ NODE_ENV: 'test', ALLOW_TEST_SEED: 'false' })).toThrow(
      TestSeedForbiddenError,
    );
    expect(() => assertTestSeedAllowed({ NODE_ENV: 'test', ALLOW_TEST_SEED: 'true' })).not.toThrow();
  });
  it('같은 시드는 같은 수열 (리플레이 가능)', () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    const seqA = Array.from({ length: 20 }, () => a.int(6));
    expect(Array.from({ length: 20 }, () => b.int(6))).toEqual(seqA);
    expect(seqA.every((v) => v >= 0 && v < 6)).toBe(true);
  });
});

describe('E-14: 요청 빈도 제한', () => {
  it('초당 10회까지 허용, 초과분은 무시, 3번 위반하면 연결 종료', () => {
    const rl = new RateLimiter();
    let now = 0;
    for (let i = 0; i < 10; i += 1) expect(rl.hit('c', now)).toBe('allow');
    expect(rl.hit('c', now)).toBe('drop');
    expect(rl.isFirstDrop('c')).toBe(true);
    expect(rl.hit('c', now)).toBe('drop');
    expect(rl.isFirstDrop('c')).toBe(false);
    now += 1000;
    expect(rl.hit('c', now)).toBe('allow');
    for (let i = 0; i < 10; i += 1) rl.hit('c', now);
    now += 1000;
    for (let i = 0; i < 10; i += 1) rl.hit('c', now);
    expect(rl.hit('c', now)).toBe('kick');
  });
  it('위반 기록은 10초가 지나면 사라진다', () => {
    const rl = new RateLimiter();
    for (const t of [0, 20_000, 40_000]) {
      for (let i = 0; i < 11; i += 1) expect(rl.hit('c', t)).not.toBe('kick');
    }
  });
});

describe('스케줄러 (원칙 7, 10)', () => {
  it('TimerScheduler.dispose는 남은 타이머를 모두 해제한다', async () => {
    const s = new TimerScheduler();
    let fired = 0;
    s.after(5, () => (fired += 1));
    const cancel = s.after(5, () => (fired += 10));
    cancel();
    expect(s.pending).toBe(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(fired).toBe(1);
    s.after(5, () => (fired += 100));
    s.dispose();
    expect(s.pending).toBe(0);
    s.after(1, () => (fired += 1000));
    await new Promise((r) => setTimeout(r, 20));
    expect(fired).toBe(1);
  });
  it('TimerScheduler는 콜백 예외를 삼키고 보고한다', async () => {
    const errors: unknown[] = [];
    const s = new TimerScheduler((e) => errors.push(e));
    s.after(1, () => {
      throw new Error('boom');
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(errors).toHaveLength(1);
  });
  it('VirtualScheduler는 시간 순서대로 실행한다', () => {
    const s = new VirtualScheduler(0);
    const order: number[] = [];
    s.after(20, () => order.push(2));
    s.after(10, () => order.push(1));
    s.advance(15);
    expect(order).toEqual([1]);
    expect(s.now()).toBe(15);
    s.runAll();
    expect(order).toEqual([1, 2]);
  });
});

describe('방 코드 (명세 4장)', () => {
  it('6자리, 허용 문자만, 사용 중인 코드는 피한다', async () => {
    const taken = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const code = await generateRoomCode(async (c) => taken.has(c), cryptoRng);
      expect(code).toMatch(/^[A-Z2-9]{6}$/);
      for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
      expect(taken.has(code)).toBe(false);
      taken.add(code);
    }
  });
  it('계속 충돌하면 예외', async () => {
    await expect(generateRoomCode(async () => true, cryptoRng, 5)).rejects.toThrow();
  });
});
