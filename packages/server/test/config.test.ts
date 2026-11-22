import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

describe('서버 설정 (S-04)', () => {
  it('운영에서 ALLOW_TEST_SEED=true면 시작 거부', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', ALLOW_TEST_SEED: 'true', CORS_ORIGINS: 'https://a.example' }),
    ).toThrow(ConfigError);
  });
  it('운영에서는 CORS_ORIGINS 필수, 시간 배율 1만 허용', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(ConfigError);
    expect(() =>
      loadConfig({ NODE_ENV: 'production', CORS_ORIGINS: 'https://a.example', GAME_TIMING_SCALE: '0.1' }),
    ).toThrow(ConfigError);
  });
  it('기본값', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({
      port: 2567,
      allowTestSeed: false,
      timingScale: 1,
      alonePolicy: 'continue',
      databaseUrl: null,
    });
  });
  it('잘못된 값 거부', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(ConfigError);
    expect(() => loadConfig({ ALONE_WITH_BOTS_POLICY: 'maybe' })).toThrow(ConfigError);
    expect(() => loadConfig({ GAME_TIMING_SCALE: '2' })).toThrow(ConfigError);
  });
});
