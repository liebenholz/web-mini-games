import { randomInt, randomUUID } from 'node:crypto';

/**
 * 서버 난수 출처 (S-03). 게임 로직은 이 인터페이스로만 난수를 얻는다.
 * `int(max)`는 0 이상 max 미만의 정수를 돌려준다.
 */
export interface Rng {
  int(maxExclusive: number): number;
  id(): string;
}

/** 운영 기본값: crypto.randomInt (CLAUDE.md 원칙 5) */
export const cryptoRng: Rng = {
  int: (maxExclusive) => randomInt(maxExclusive),
  id: () => randomUUID(),
};

/**
 * 테스트 전용 시드 난수 (S-04). mulberry32.
 * `assertTestSeedAllowed`를 통과한 경우에만 만들 수 있다.
 */
export function createSeededRng(seed: number): Rng {
  assertTestSeedAllowed();
  let a = seed >>> 0;
  let counter = 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    id: () => `seeded-${seed}-${(counter += 1)}`,
  };
}

export class TestSeedForbiddenError extends Error {}

/**
 * S-04, CLAUDE.md 원칙 6: 시드 주입은 ALLOW_TEST_SEED=true일 때만 허용하고,
 * NODE_ENV=production이면 켜져 있어도 거부한다.
 */
export function assertTestSeedAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') throw new TestSeedForbiddenError('test seed is forbidden in production');
  if (env.ALLOW_TEST_SEED !== 'true') {
    throw new TestSeedForbiddenError('set ALLOW_TEST_SEED=true to inject a seed');
  }
}
