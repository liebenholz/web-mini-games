import { defineConfig, devices } from '@playwright/test';

/**
 * M4 E2E: 사람 1명 + 봇 2명으로 한 판 완주.
 * 게임 서버는 E2E 전용 포트와 시간 배율(GAME_TIMING_SCALE)로 띄운다. 운영에서는 이 배율이 거부된다.
 */
const SERVER_PORT = 2568;
const CLIENT_PORT = 5174;

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  fullyParallel: false,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    trace: 'retain-on-failure',
    // 설치된 Chrome을 쓰려면 PW_CHANNEL=chrome (CI는 러너 이미지의 Chrome을 이렇게 쓴다)
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  },
  projects: [
    {
      name: 'mobile-360',
      // Pixel 5의 화소 밀도(2.75)로 캔버스를 그리면 GPU 없는 CI 러너가 크게 느려져 짧은 턴 안에 클릭을 놓친다.
      // 게임 흐름은 화소 밀도와 무관하므로 1로 두고, 고해상도 렌더링은 play.spec.ts의 DPR 2 테스트가 따로 검사한다
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 740 }, deviceScaleFactor: 1 },
    },
  ],
  webServer: [
    {
      command: `pnpm --filter server exec tsx --conditions=source src/index.ts`,
      // E2E는 한 주소(localhost)에서 방을 많이 만든다. IP별 방 만들기 제한은 끈다
      env: {
        PORT: String(SERVER_PORT),
        GAME_TIMING_SCALE: '0.05',
        NODE_ENV: 'development',
        MATCHMAKE_PER_MINUTE: '0',
      },
      url: `http://localhost:${SERVER_PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm exec vite --port ${CLIENT_PORT} --strictPort`,
      env: { VITE_SERVER_URL: `ws://localhost:${SERVER_PORT}` },
      url: `http://localhost:${CLIENT_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
