import { createHash } from 'node:crypto';
import { kstDay, parseClientErrorReport, type ClientErrorKind } from '@wmg/rules';
import type { ClientErrorRow, StatsStore } from './stats.js';

/**
 * 클라이언트 오류 수집 (docs/specs/client-errors.md).
 * 보고는 메모리에서 같은 지문끼리 개수만 더해 두고, 1분마다 한 번에 저장한다 (CE-07, 원칙 8).
 */
export interface ClientErrorServiceOptions {
  readonly now?: () => number;
  /** CE-06: 1초에 받는 새 보고 수 */
  readonly maxReportsPerSecond?: number;
  /** CE-06: 하루에 따로 세는 서로 다른 지문 수 */
  readonly maxFingerprintsPerDay?: number;
  readonly log?: (level: 'warn', message: string, extra?: Record<string, unknown>) => void;
}

/** CE-06: (kind, game, 문구)의 지문. 날짜는 키에 따로 들어간다 */
export function errorFingerprint(kind: string, game: string | null, message: string): string {
  return createHash('sha256')
    .update(`${kind}\u0000${game ?? ''}\u0000${message}`)
    .digest('hex')
    .slice(0, 16);
}

export class ClientErrorService {
  readonly #store: Pick<StatsStore, 'addClientErrors'>;
  readonly #now: () => number;
  readonly #maxPerSecond: number;
  readonly #maxFingerprints: number;
  readonly #log: NonNullable<ClientErrorServiceOptions['log']>;
  /** 아직 저장하지 않은 개수. 키는 `${day}|${fingerprint}` */
  #pending = new Map<string, ClientErrorRow>();
  /** CE-06: 오늘 본 지문 (저장한 것 포함) */
  #day = '';
  #seen = new Set<string>();
  #windowStart = 0;
  #windowCount = 0;
  #timer: NodeJS.Timeout | null = null;
  #flushing: Promise<void> | null = null;

  constructor(store: Pick<StatsStore, 'addClientErrors'>, options: ClientErrorServiceOptions = {}) {
    this.#store = store;
    this.#now = options.now ?? Date.now;
    this.#maxPerSecond = options.maxReportsPerSecond ?? 20;
    this.#maxFingerprints = options.maxFingerprintsPerDay ?? 500;
    this.#log = options.log ?? (() => {});
  }

  /** CE-05, CE-06: 형식이 틀리면 false (400). 넘치는 보고는 조용히 버리고 true */
  report(input: unknown): boolean {
    const r = parseClientErrorReport(input);
    if (!r) return false;
    const now = this.#now();
    if (now - this.#windowStart >= 1000) {
      this.#windowStart = now;
      this.#windowCount = 0;
    }
    if (this.#windowCount >= this.#maxPerSecond) return true;
    this.#windowCount += 1;

    const day = kstDay(now);
    if (day !== this.#day) {
      this.#day = day;
      this.#seen = new Set();
    }
    let fingerprint = errorFingerprint(r.kind, r.game, r.message);
    let message = r.message;
    let game = r.game;
    if (!this.#seen.has(fingerprint)) {
      if (this.#seen.size >= this.#maxFingerprints) {
        // CE-06: 넘친 지문은 kind별 하나로 센다
        fingerprint = `other:${r.kind}`;
        message = '(그 밖의 오류)';
        game = null;
      } else {
        this.#seen.add(fingerprint);
      }
    }
    const key = `${day}|${fingerprint}`;
    const prev = this.#pending.get(key);
    this.#pending.set(
      key,
      prev
        ? { ...prev, count: prev.count + 1 }
        : {
            day,
            fingerprint,
            kind: r.kind,
            game,
            message,
            release: r.release,
            platform: r.platform,
            count: 1,
          },
    );
    return true;
  }

  /** CE-07: 모아 둔 개수를 한 번에 저장한다. 실패하면 다음 번에 다시 더해서 쓴다 */
  flush(): Promise<void> {
    if (this.#flushing) return this.#flushing;
    if (this.#pending.size === 0) return Promise.resolve();
    const batch = this.#pending;
    this.#pending = new Map();
    this.#flushing = this.#store
      .addClientErrors([...batch.values()])
      .catch((error: unknown) => {
        this.#log('warn', 'client errors not recorded, will retry', {
          error: String(error),
          rows: batch.size,
        });
        for (const [key, row] of batch) {
          const now = this.#pending.get(key);
          this.#pending.set(key, now ? { ...row, count: row.count + now.count } : row);
        }
      })
      .finally(() => {
        this.#flushing = null;
      });
    return this.#flushing;
  }

  /** 지금 모아 둔 종류별 개수 (테스트와 진단용) */
  pendingCounts(): Partial<Record<ClientErrorKind, number>> {
    const out: Partial<Record<ClientErrorKind, number>> = {};
    for (const r of this.#pending.values()) {
      const k = r.kind as ClientErrorKind;
      out[k] = (out[k] ?? 0) + r.count;
    }
    return out;
  }

  /** 프로세스에 타이머 하나 (원칙 7과 같은 이유로 방마다 두지 않는다) */
  start(intervalMs = 60_000): void {
    if (this.#timer || intervalMs <= 0) return;
    this.#timer = setInterval(() => void this.flush(), intervalMs);
    this.#timer.unref();
  }

  /** CE-07: 서버가 꺼질 때 남은 것을 한 번 쓴다 */
  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.flush();
  }
}
