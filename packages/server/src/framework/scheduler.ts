/**
 * 단발 타이머 스케줄러 (CLAUDE.md 원칙 7: 틱 루프 없이 마감 시각 하나에 거는 타이머).
 * 방이 끝나면 `dispose()`로 남은 타이머를 모두 해제한다 (원칙 10).
 */
export interface Scheduler {
  now(): number;
  /** ms 뒤에 fn을 한 번 실행한다. 돌려받은 함수로 취소한다. */
  after(ms: number, fn: () => void): () => void;
  dispose(): void;
  readonly pending: number;
}

/** 실제 시간 스케줄러 (setTimeout) */
export class TimerScheduler implements Scheduler {
  #timers = new Set<NodeJS.Timeout>();
  #disposed = false;

  constructor(private readonly onError: (error: unknown) => void = (e) => console.error(e)) {}

  now(): number {
    return Date.now();
  }

  after(ms: number, fn: () => void): () => void {
    if (this.#disposed) return () => {};
    const handle = setTimeout(
      () => {
        this.#timers.delete(handle);
        try {
          fn();
        } catch (error) {
          this.onError(error);
        }
      },
      Math.max(0, ms),
    );
    this.#timers.add(handle);
    return () => {
      clearTimeout(handle);
      this.#timers.delete(handle);
    };
  }

  get pending(): number {
    return this.#timers.size;
  }

  dispose(): void {
    this.#disposed = true;
    for (const t of this.#timers) clearTimeout(t);
    this.#timers.clear();
  }
}

/** 테스트용 가상 시간 스케줄러. 실제로 기다리지 않고 시간 순서대로 실행한다. */
export class VirtualScheduler implements Scheduler {
  #now: number;
  #seq = 0;
  #queue: Array<{ at: number; seq: number; fn: () => void }> = [];

  constructor(start = 1_000_000) {
    this.#now = start;
  }

  now(): number {
    return this.#now;
  }

  after(ms: number, fn: () => void): () => void {
    const entry = { at: this.#now + Math.max(0, ms), seq: (this.#seq += 1), fn };
    this.#queue.push(entry);
    return () => {
      this.#queue = this.#queue.filter((e) => e !== entry);
    };
  }

  get pending(): number {
    return this.#queue.length;
  }

  /** 다음 타이머 하나를 실행한다. 없으면 false. */
  step(): boolean {
    if (this.#queue.length === 0) return false;
    this.#queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const entry = this.#queue.shift();
    if (!entry) return false;
    this.#now = Math.max(this.#now, entry.at);
    entry.fn();
    return true;
  }

  /** ms만큼 시간을 흘려 그 사이 타이머를 모두 실행한다. */
  advance(ms: number): void {
    const target = this.#now + ms;
    for (;;) {
      this.#queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const head = this.#queue[0];
      if (!head || head.at > target) break;
      this.step();
    }
    this.#now = target;
  }

  /** 타이머가 없어질 때까지 실행한다. 무한 루프를 막으려고 상한을 둔다. */
  runAll(limit = 1_000_000): number {
    let n = 0;
    while (this.step()) {
      n += 1;
      if (n >= limit) throw new Error('VirtualScheduler.runAll limit reached');
    }
    return n;
  }

  dispose(): void {
    this.#queue = [];
  }
}
