import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // 봇끼리 1,000판 시뮬레이션(BT-12, 원카드)은 로컬 2초 안팎이지만 CI 러너에서 5초 기본값을 넘기기도 한다
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'text'],
      // phase1 M1 완료 기준: 라인 커버리지 90% 이상
      thresholds: { lines: 90 },
    },
  },
});
