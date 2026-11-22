import type { AloneWithBotsPolicy } from './games/liars-dice/LiarsDiceMatch.js';

export interface ServerConfig {
  readonly nodeEnv: string;
  readonly port: number;
  readonly corsOrigins: readonly string[];
  readonly databaseUrl: string | null;
  readonly redisUrl: string | null;
  readonly allowTestSeed: boolean;
  readonly drainSeconds: number;
  readonly alonePolicy: AloneWithBotsPolicy;
  /** 개발·E2E 전용: 턴/연출/봇 지연 시간 배율 (0 < x ≤ 1). 운영에서는 1만 허용 */
  readonly timingScale: number;
}

export class ConfigError extends Error {}

function intEnv(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new ConfigError(`${name} must be a non-negative integer`);
  return n;
}

/** 환경 변수를 검증한다. S-04: 운영에서 테스트 시드가 켜져 있으면 시작을 거부한다. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const allowTestSeed = env.ALLOW_TEST_SEED === 'true';
  if (nodeEnv === 'production' && allowTestSeed) {
    throw new ConfigError('ALLOW_TEST_SEED=true is forbidden when NODE_ENV=production (S-04)');
  }
  const alone = env.ALONE_WITH_BOTS_POLICY ?? 'continue';
  if (alone !== 'continue' && alone !== 'end')
    throw new ConfigError('ALONE_WITH_BOTS_POLICY must be continue|end');
  const corsOrigins = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (nodeEnv === 'production' && corsOrigins.length === 0) {
    throw new ConfigError('CORS_ORIGINS is required in production');
  }
  const timingScale = env.GAME_TIMING_SCALE ? Number(env.GAME_TIMING_SCALE) : 1;
  if (!(timingScale > 0 && timingScale <= 1)) throw new ConfigError('GAME_TIMING_SCALE must be in (0, 1]');
  if (nodeEnv === 'production' && timingScale !== 1)
    throw new ConfigError('GAME_TIMING_SCALE is forbidden in production');
  return {
    nodeEnv,
    timingScale,
    port: intEnv(env.PORT, 2567, 'PORT'),
    corsOrigins,
    databaseUrl: env.DATABASE_URL || null,
    redisUrl: env.REDIS_URL || null,
    allowTestSeed,
    drainSeconds: intEnv(env.SHUTDOWN_DRAIN_SECONDS, 900, 'SHUTDOWN_DRAIN_SECONDS'),
    alonePolicy: alone,
  };
}
