import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'text'],
      // phase1 M1 완료 기준: 라인 커버리지 90% 이상
      thresholds: { lines: 90 },
    },
  },
});
