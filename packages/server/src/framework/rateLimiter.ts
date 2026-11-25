/**
 * E-14: 클라이언트별 초당 요청 수 제한.
 * - 1초 창에서 limit를 넘는 메시지는 무시한다 ('drop')
 * - 위반한 창이 strikeWindowMs 안에 maxStrikes번 쌓이면 연결을 끊는다 ('kick')
 */
import { counters } from '../metrics/metrics.js';

export type RateDecision = 'allow' | 'drop' | 'kick';

export interface RateLimiterOptions {
  readonly limit: number;
  readonly windowMs: number;
  readonly maxStrikes: number;
  readonly strikeWindowMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimiterOptions = Object.freeze({
  limit: 10,
  windowMs: 1000,
  maxStrikes: 3,
  strikeWindowMs: 10_000,
});

interface Bucket {
  windowStart: number;
  count: number;
  /** 이번 창에서 이미 위반을 기록했는지 */
  struck: boolean;
  strikes: number[];
}

export class RateLimiter {
  #buckets = new Map<string, Bucket>();

  constructor(private readonly options: RateLimiterOptions = DEFAULT_RATE_LIMIT) {}

  hit(key: string, now: number): RateDecision {
    let bucket = this.#buckets.get(key);
    if (!bucket || now - bucket.windowStart >= this.options.windowMs) {
      bucket = { windowStart: now, count: 0, struck: false, strikes: bucket?.strikes ?? [] };
      this.#buckets.set(key, bucket);
    }
    bucket.count += 1;
    // 모든 방의 클라이언트 메시지가 여기를 지나므로 운영 지표도 여기서 센다
    counters.messages += 1;
    if (bucket.count <= this.options.limit) return 'allow';
    counters.rateLimited += 1;
    if (!bucket.struck) {
      bucket.struck = true;
      bucket.strikes = bucket.strikes.filter((t) => now - t < this.options.strikeWindowMs);
      bucket.strikes.push(now);
      if (bucket.strikes.length >= this.options.maxStrikes) return 'kick';
    }
    return 'drop';
  }

  /** 이번 창에서 처음 막힌 메시지인지 (에러를 한 번만 보내기 위해) */
  isFirstDrop(key: string): boolean {
    const b = this.#buckets.get(key);
    return b !== undefined && b.count === this.options.limit + 1;
  }

  forget(key: string): void {
    this.#buckets.delete(key);
  }

  clear(): void {
    this.#buckets.clear();
  }
}
