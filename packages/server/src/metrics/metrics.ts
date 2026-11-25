import { createHash, timingSafeEqual } from 'node:crypto';
import { monitorEventLoopDelay, performance, type EventLoopUtilization } from 'node:perf_hooks';

/**
 * 운영 지표 (docs/ops/deploy-oracle.md 15장). 외부 라이브러리 없이 Node 내장 기능만 쓴다.
 * - 누적 카운터는 방과 저장소가 올린다
 * - 수집기는 정해진 간격마다 한 번 표본을 만들고 그 간격 동안의 변화량을 계산한다
 * - 표본은 JSON 한 줄 로그로 남기고, 마지막 표본은 /metrics로 읽는다
 */

/** 서버가 켜진 뒤 누적값. 방과 저장소가 직접 올린다 */
export const counters = {
  /** 클라이언트가 보낸 게임 메시지 (빈도 제한 검사를 지난 수 + 막힌 수) */
  messages: 0,
  /** E-14로 버리거나 끊은 메시지 */
  rateLimited: 0,
  /** 판 기록 저장 실패 후 재시도 */
  dbRetries: 0,
  /** 재시도를 다 쓰고 버린 판 기록 */
  dbDropped: 0,
};
export type Counters = typeof counters;

/** 지표가 읽는 방 정보. Colyseus Room이 이 모양을 만족한다 */
export interface ActiveRoom {
  readonly inProgress: boolean;
  readonly roomName: string;
  readonly clients: { readonly length: number };
}

export interface MetricsSnapshot {
  readonly time: string;
  readonly uptimeSec: number;
  /** 이 표본이 덮는 시간(초) */
  readonly windowSec: number;
  readonly memoryMb: { rss: number; heapUsed: number; heapTotal: number; external: number };
  /** 코어 1개를 100으로 본 CPU 사용률 */
  readonly cpuPercent: number;
  readonly eventLoop: { p50Ms: number; p99Ms: number; maxMs: number; utilization: number };
  readonly rooms: { total: number; inProgress: number; clients: number; byGame: Record<string, number> };
  /** 이번 간격 동안 늘어난 양 */
  readonly window: Counters & { messagesPerSec: number };
  readonly totals: Counters;
}

/** 시스템 값을 읽는 부분. 테스트에서 바꿔 끼운다 */
export interface SystemProbe {
  now(): number;
  memory(): NodeJS.MemoryUsage;
  /** 직전 값 이후 CPU 사용 시간(마이크로초) */
  cpu(prev?: NodeJS.CpuUsage): NodeJS.CpuUsage;
  elu(prev?: EventLoopUtilization): EventLoopUtilization;
  /** 지연 분포를 읽고 비운다 (밀리초) */
  takeDelay(): { p50: number; p99: number; max: number };
  stop(): void;
}

export function nodeProbe(): SystemProbe {
  const resolutionMs = 10;
  const histogram = monitorEventLoopDelay({ resolution: resolutionMs });
  histogram.enable();
  // 이 히스토그램은 타이머 간격(resolution)까지 포함해 재므로 빼야 순수 지연이 된다. 한가하면 0 근처
  const ms = (ns: number) => (Number.isFinite(ns) ? Math.max(0, ns / 1e6 - resolutionMs) : 0);
  return {
    now: () => Date.now(),
    memory: () => process.memoryUsage(),
    cpu: (prev) => process.cpuUsage(prev),
    elu: (prev) => performance.eventLoopUtilization(prev),
    takeDelay: () => {
      const out = {
        p50: ms(histogram.percentile(50)),
        p99: ms(histogram.percentile(99)),
        max: ms(histogram.max),
      };
      histogram.reset();
      return out;
    },
    stop: () => histogram.disable(),
  };
}

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;
const mb = (bytes: number) => round(bytes / 1024 / 1024);

export class MetricsCollector {
  readonly #rooms: () => Iterable<ActiveRoom>;
  readonly #counters: Counters;
  readonly #probe: SystemProbe;
  readonly #startedAt: number;
  #lastAt: number;
  #lastCpu: NodeJS.CpuUsage;
  #lastElu: EventLoopUtilization;
  #lastTotals: Counters;
  #latest: MetricsSnapshot | null = null;
  #timer: NodeJS.Timeout | null = null;

  constructor(options: { rooms: () => Iterable<ActiveRoom>; counters?: Counters; probe?: SystemProbe }) {
    this.#rooms = options.rooms;
    this.#counters = options.counters ?? counters;
    this.#probe = options.probe ?? nodeProbe();
    this.#startedAt = this.#lastAt = this.#probe.now();
    this.#lastCpu = this.#probe.cpu();
    this.#lastElu = this.#probe.elu();
    this.#lastTotals = { ...this.#counters };
  }

  /** 직전 표본 이후 변화를 계산해 새 표본을 만든다 */
  sample(): MetricsSnapshot {
    const now = this.#probe.now();
    const elapsedMs = Math.max(1, now - this.#lastAt);
    const cpu = this.#probe.cpu(this.#lastCpu);
    const elu = this.#probe.elu(this.#lastElu);
    const delay = this.#probe.takeDelay();
    const mem = this.#probe.memory();

    const totals = { ...this.#counters };
    const window = {
      messages: totals.messages - this.#lastTotals.messages,
      rateLimited: totals.rateLimited - this.#lastTotals.rateLimited,
      dbRetries: totals.dbRetries - this.#lastTotals.dbRetries,
      dbDropped: totals.dbDropped - this.#lastTotals.dbDropped,
    };

    const byGame: Record<string, number> = {};
    let total = 0;
    let inProgress = 0;
    let clients = 0;
    for (const room of this.#rooms()) {
      total += 1;
      if (room.inProgress) inProgress += 1;
      clients += room.clients.length;
      byGame[room.roomName] = (byGame[room.roomName] ?? 0) + 1;
    }

    const snapshot: MetricsSnapshot = {
      time: new Date(now).toISOString(),
      uptimeSec: Math.round((now - this.#startedAt) / 1000),
      windowSec: round(elapsedMs / 1000),
      memoryMb: {
        rss: mb(mem.rss),
        heapUsed: mb(mem.heapUsed),
        heapTotal: mb(mem.heapTotal),
        external: mb(mem.external),
      },
      cpuPercent: round(((cpu.user + cpu.system) / 1000 / elapsedMs) * 100),
      eventLoop: {
        p50Ms: round(delay.p50),
        p99Ms: round(delay.p99),
        maxMs: round(delay.max),
        utilization: round(elu.utilization, 3),
      },
      rooms: { total, inProgress, clients, byGame },
      window: { ...window, messagesPerSec: round(window.messages / (elapsedMs / 1000)) },
      totals,
    };

    this.#lastAt = now;
    this.#lastCpu = this.#probe.cpu();
    this.#lastElu = this.#probe.elu();
    this.#lastTotals = totals;
    this.#latest = snapshot;
    return snapshot;
  }

  /** 마지막 표본. 아직 없으면 지금 만든다 */
  latest(): MetricsSnapshot {
    return this.#latest ?? this.sample();
  }

  /** intervalMs마다 표본을 만들어 onSample로 넘긴다 (로그 한 줄) */
  start(intervalMs: number, onSample: (s: MetricsSnapshot) => void): void {
    if (this.#timer || intervalMs <= 0) return;
    this.#timer = setInterval(() => onSample(this.sample()), intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#probe.stop();
  }
}

/** Authorization: Bearer <token> 를 시간 차 없이 비교한다. 토큰이 없으면 항상 거부 */
export function checkBearer(header: string | null | undefined, token: string | null): boolean {
  if (!token || !header?.startsWith('Bearer ')) return false;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(header.slice('Bearer '.length)), digest(token));
}
