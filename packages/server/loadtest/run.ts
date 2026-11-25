/**
 * M6 부하 테스트 실행기. 사용법은 docs/ops/load-test.md.
 *
 *   pnpm --filter server loadtest -- --url wss://api.example.com --stages 10,25,50 --minutes 5
 *
 * 단계마다 동시 방 수를 맞춰 계속 판을 돌리고, 서버 /metrics를 10초마다 읽는다.
 * 이벤트 루프 p99가 기준을 두 번 연속 넘거나 접속 실패가 쌓이면 바로 멈춘다.
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { GAME_TYPES, newStats, playOneGame, type GameType, type RoomStats } from './room.js';

interface ServerSample {
  readonly time: string;
  readonly memoryMb: { rss: number; heapUsed: number };
  readonly cpuPercent: number;
  readonly eventLoop: { p50Ms: number; p99Ms: number; maxMs: number; utilization: number };
  readonly rooms: { total: number; inProgress: number; clients: number; byGame: Record<string, number> };
  readonly window: { messagesPerSec: number; rateLimited: number; dbRetries: number; dbDropped: number };
}

// pnpm --filter server loadtest -- --url … 는 '--'까지 넘기므로 맨 앞의 '--'는 버린다
const argv = process.argv.slice(2);
const { values } = parseArgs({
  args: argv[0] === '--' ? argv.slice(1) : argv,
  options: {
    url: { type: 'string', default: 'ws://localhost:2567' },
    token: { type: 'string', default: process.env.METRICS_TOKEN ?? '' },
    stages: { type: 'string', default: '5,10,25,50' },
    minutes: { type: 'string', default: '5' },
    mix: { type: 'string', default: 'gomoku:4,liars_dice:2,one_card:2,bulls_and_cows:2' },
    think: { type: 'string', default: '800-2500' },
    'abort-p99': { type: 'string', default: '200' },
    'max-join-failures': { type: 'string', default: '20' },
    out: { type: 'string', default: `loadtest-${new Date().toISOString().replace(/[:.]/g, '-')}.json` },
  },
});

const stages = values.stages.split(',').map(Number);
const stageMs = Number(values.minutes) * 60_000;
const abortP99 = Number(values['abort-p99']);
const maxJoinFailures = Number(values['max-join-failures']);
const [thinkLo = NaN, thinkHi = NaN] = values.think.split('-').map(Number);
const thinkMs: readonly [number, number] = [thinkLo, thinkHi];
/** 가중치대로 번갈아 고른다. gomoku:2,liars_dice:1 → gomoku, liars_dice, gomoku, … */
const weights = values.mix.split(',').map((part) => {
  const [game, weight] = part.split(':');
  if (!GAME_TYPES.includes(game as GameType)) throw new Error(`unknown game in --mix: ${game}`);
  return { game: game as GameType, left: Number(weight ?? 1) };
});
const mix: GameType[] = [];
while (weights.some((w) => w.left > 0)) {
  for (const w of weights) {
    if (w.left > 0) {
      mix.push(w.game);
      w.left -= 1;
    }
  }
}
if (stages.some((n) => !(n > 0)) || !(stageMs > 0) || !(thinkHi >= thinkLo) || mix.length === 0) {
  throw new Error('invalid arguments');
}
const httpBase = values.url.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, '');

const controller = new AbortController();
process.on('SIGINT', () => {
  console.log('\nSIGINT: stopping (players leave, rooms end without records)');
  controller.abort();
});

async function readMetrics(): Promise<ServerSample | null> {
  if (!values.token) return null;
  try {
    const res = await fetch(`${httpBase}/metrics`, { headers: { authorization: `Bearer ${values.token}` } });
    return res.ok ? ((await res.json()) as ServerSample) : null;
  } catch {
    return null;
  }
}

/** 지금 단계의 접속 쪽 기록. 앞 단계에서 만든 방 자리도 새 판부터 여기에 쓴다 */
let stageStats: RoomStats = newStats();
const safeArgs = { ...values, token: values.token ? '***' : '' };

let slot = 0;
let joinFailures = 0;
let gamesFinished = 0;

/** 방 자리 하나. 멈추라고 할 때까지 판을 연달아 돌린다 */
async function roomLoop(stop: AbortSignal): Promise<void> {
  while (!stop.aborted && !controller.signal.aborted) {
    const game = mix[slot++ % mix.length] ?? 'gomoku';
    const stats = stageStats;
    try {
      await playOneGame({
        endpoint: values.url,
        game,
        thinkMs,
        stats,
        signal: AbortSignal.any([stop, controller.signal]),
        maxGameMs: 20 * 60_000,
      });
      gamesFinished += 1;
    } catch (error) {
      joinFailures += 1;
      const code = (error as { code?: unknown }).code ?? (error as Error).message;
      stats.errors.set(`join:${String(code)}`, (stats.errors.get(`join:${String(code)}`) ?? 0) + 1);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

const percentile = (xs: number[], p: number) => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
};

interface StageResult {
  targetRooms: number;
  samples: ServerSample[];
  client: {
    joinP50Ms: number;
    joinP99Ms: number;
    errors: Record<string, number>;
    disconnects: number;
    actions: number;
  };
  aborted: string | null;
}

async function main(): Promise<void> {
  if (!values.token) console.warn('METRICS_TOKEN not set: server metrics will not be recorded');
  const results: StageResult[] = [];
  const loops: { stop: AbortController; done: Promise<void> }[] = [];
  let abortReason: string | null = null;

  for (const target of stages) {
    if (controller.signal.aborted) break;
    stageStats = newStats();
    const stats = stageStats;
    while (loops.length < target) {
      const stop = new AbortController();
      loops.push({ stop, done: roomLoop(stop.signal) });
      await new Promise((r) => setTimeout(r, 150)); // 방 만들기를 조금씩 흩어 놓는다
    }
    console.log(`\n== stage: ${target} rooms for ${values.minutes} min`);
    const samples: ServerSample[] = [];
    let overP99 = 0;
    const until = Date.now() + stageMs;
    while (Date.now() < until && !controller.signal.aborted) {
      await new Promise((r) => setTimeout(r, 10_000));
      const m = await readMetrics();
      if (m) {
        samples.push(m);
        console.log(
          `rooms ${m.rooms.total} (in game ${m.rooms.inProgress}) clients ${m.rooms.clients} | ` +
            `rss ${m.memoryMb.rss}MB cpu ${m.cpuPercent}% | loop p99 ${m.eventLoop.p99Ms}ms max ${m.eventLoop.maxMs}ms | ` +
            `msg/s ${m.window.messagesPerSec} | games done ${gamesFinished} | join failures ${joinFailures}`,
        );
        overP99 = m.eventLoop.p99Ms > abortP99 ? overP99 + 1 : 0;
        if (overP99 >= 2) abortReason = `event loop p99 > ${abortP99}ms twice`;
      } else {
        console.log(`(no metrics) games done ${gamesFinished} | join failures ${joinFailures}`);
      }
      if (joinFailures >= maxJoinFailures) abortReason = `${joinFailures} join failures`;
      if (abortReason) {
        console.log(`ABORT: ${abortReason}`);
        controller.abort();
      }
    }
    results.push({
      targetRooms: target,
      samples,
      client: {
        joinP50Ms: Math.round(percentile(stats.joinMs, 50)),
        joinP99Ms: Math.round(percentile(stats.joinMs, 99)),
        errors: Object.fromEntries(stats.errors),
        disconnects: stats.disconnects,
        actions: stats.actions,
      },
      aborted: abortReason,
    });
    writeFileSync(values.out, JSON.stringify({ args: safeArgs, gamesFinished, results }, null, 2));
  }

  // 모든 사람이 나간다. 진행 중인 방은 기록 없이 끝난다 (E-10)
  for (const l of loops) l.stop.abort();
  controller.abort();
  await Promise.allSettled(loops.map((l) => l.done));
  writeFileSync(values.out, JSON.stringify({ args: safeArgs, gamesFinished, results }, null, 2));
  console.log(`\nresults: ${values.out} (games finished ${gamesFinished})`);
  process.exit(0);
}

void main();
