import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // 빌드 없이 rules 소스를 바로 쓴다
    alias: { '@wmg/rules': fileURLToPath(new URL('../rules/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // 통합 테스트는 포트를 쓰므로 파일 단위로 순차 실행
    fileParallelism: false,
    env: { NODE_ENV: 'test', ALLOW_TEST_SEED: 'true' },
  },
});
