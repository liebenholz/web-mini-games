import { RedisDriver } from '@colyseus/redis-driver';
import { RedisPresence } from '@colyseus/redis-presence';
import { createGameServer } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { DEFAULT_TIMING } from './games/liars-dice/LiarsDiceMatch.js';
import { activeRooms, configureLiarsDice, runtime } from './games/liars-dice/runtime.js';
import { migrate, PgRecorder } from './persistence/pgRecorder.js';
import { MemoryStats, PgStatsStore, StatsService } from './stats/stats.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const k = config.timingScale;
  configureLiarsDice({
    alonePolicy: config.alonePolicy,
    timing: {
      startCountdownMs: DEFAULT_TIMING.startCountdownMs * k,
      revealMs: DEFAULT_TIMING.revealMs * k,
      botDelayMinMs: DEFAULT_TIMING.botDelayMinMs * k,
      botDelayMaxMs: DEFAULT_TIMING.botDelayMaxMs * k,
      msPerTurnSecond: DEFAULT_TIMING.msPerTurnSecond * k,
    },
  });

  let recorder: PgRecorder | null = null;
  let stats: StatsService;
  if (config.databaseUrl) {
    recorder = new PgRecorder({ connectionString: config.databaseUrl, log: runtime.log });
    try {
      const applied = await migrate(recorder.pool);
      if (applied.length > 0) runtime.log('info', 'migrations applied', { applied });
    } catch (error) {
      // M3: DB가 없어도 게임은 진행한다. 저장은 재시도에 맡긴다
      runtime.log('error', 'migration failed; continuing without guaranteed persistence', {
        error: String(error),
      });
    }
    configureLiarsDice({ recorder });
    stats = new StatsService(new PgStatsStore(recorder.pool), { log: runtime.log });
  } else {
    runtime.log('warn', 'DATABASE_URL not set; game records are not stored');
    // 개발·E2E: 통계만 메모리에 센다 (재시작하면 사라진다)
    const memory = new MemoryStats();
    configureLiarsDice({ recorder: memory });
    stats = new StatsService(memory, { log: runtime.log });
  }

  const server = createGameServer({
    config,
    stats,
    ...(config.redisUrl
      ? { presence: new RedisPresence(config.redisUrl), driver: new RedisDriver(config.redisUrl) }
      : {}),
  });
  await server.listen(config.port);
  runtime.log('info', 'server listening', { port: config.port, env: config.nodeEnv });

  // M5: 종료 신호를 받으면 새 방을 막고, 진행 중인 판이 끝날 때까지(최대 drainSeconds) 기다린다
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    runtime.draining = true;
    const deadline = Date.now() + config.drainSeconds * 1000;
    runtime.log('info', 'draining', { signal, rooms: activeRooms.size });
    while (Date.now() < deadline && [...activeRooms].some((r) => r.inProgress)) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    runtime.log('info', 'shutting down', {
      stillInProgress: [...activeRooms].filter((r) => r.inProgress).length,
    });
    await server.gracefullyShutdown(false);
    await recorder?.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) console.error(`config error: ${error.message}`);
  else console.error(error);
  process.exit(1);
});
