import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@wmg/rules': fileURLToPath(new URL('../rules/src/index.ts', import.meta.url)) },
  },
  server: { port: 5173, host: true },
  build: {
    target: 'es2022',
    // Phaser는 게임 화면에서만 불러온다 (로비 첫 로딩을 가볍게)
    chunkSizeWarningLimit: 1600,
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
