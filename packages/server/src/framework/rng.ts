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

/** S-03: 주사위 하나 (1~6). 거짓말쟁이 주사위가 쓰고 TC-15 검증 스크립트가 같은 함수를 잰다 */
export function rollDie(rng: Rng): 1 | 2 | 3 | 4 | 5 | 6 {
  return (rng.int(6) + 1) as 1 | 2 | 3 | 4 | 5 | 6;
}

/** Fisher-Yates. 원본은 바꾸지 않는다. 원카드 덱 섞기에 쓴다 */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/**
 * 테스트 전용 시드 난수 (S-04). mulberry32.
 * `assertTestSeedAllowed`를 통과한 경우에만 만들 수 있다.
 */
export function createSeededRng(seed: number): Rng {
  assertTestSeedAllowed();
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    // 운영의 randomUUID와 같은 v4 형식으로 만든다 (DB의 uuid 컬럼에 그대로 들어가야 한다)
    id: () => {
      const hex = Array.from({ length: 32 }, () => Math.floor(next() * 16).toString(16));
      hex[12] = '4';
      hex[16] = (8 + Math.floor(next() * 4)).toString(16);
      const s = hex.join('');
      return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
    },
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
