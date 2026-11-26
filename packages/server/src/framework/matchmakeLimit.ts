import { matchMaker, ServerError } from '@colyseus/core';

/**
 * 방 만들기·입장(매칭 HTTP 요청)의 IP별 분당 제한 (보안 점검 2026-11-27).
 * 게임 메시지 제한(E-14, rateLimiter.ts)과 별개로, 한 곳에서 방을 대량으로 만들어 서버를 멈추게 하는 것을 막는다.
 * - IP는 Colyseus가 X-Real-IP → X-Forwarded-For 첫 값 → 연결 주소 순으로 읽는다.
 *   운영 Caddy가 X-Real-IP를 실제 접속 주소로 덮어쓰므로 클라이언트가 바꿀 수 없다 (infra/caddy/Caddyfile)
 * - 재접속(reconnect)은 세지 않는다. 네트워크가 흔들릴 때 막히면 안 된다
 * - 같은 IP를 여러 사람이 함께 쓰는 경우(학교, 회사, 통신사 공용 IP)를 생각해 한도는 넉넉히 둔다
 */
export class IpWindowLimiter {
  #windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly perWindow: number,
    private readonly windowMs = 60_000,
    private readonly maxKeys = 50_000,
  ) {}

  /** 허용하면 true. ip를 모르면 막지 않는다 */
  allow(ip: string | undefined, now: number): boolean {
    if (this.perWindow <= 0 || !ip) return true;
    let w = this.#windows.get(ip);
    if (!w || now - w.start >= this.windowMs) {
      if (!w && this.#windows.size >= this.maxKeys) this.#prune(now);
      w = { start: now, count: 0 };
      this.#windows.set(ip, w);
    }
    w.count += 1;
    return w.count <= this.perWindow;
  }

  get size(): number {
    return this.#windows.size;
  }

  #prune(now: number): void {
    for (const [ip, w] of this.#windows) if (now - w.start >= this.windowMs) this.#windows.delete(ip);
    // 그래도 가득하면 가장 오래된 것부터 지운다 (메모리 상한)
    while (this.#windows.size >= this.maxKeys) {
      const first = this.#windows.keys().next();
      if (first.done) break;
      this.#windows.delete(first.value);
    }
  }
}

const HTTP_TOO_MANY_REQUESTS = 429;
let installed: { readonly original: typeof matchMaker.controller.invokeMethod } | null = null;

/**
 * 매칭 HTTP 요청 앞에 IP별 제한을 건다. perMinute가 0이면 걸지 않는다.
 * 거절 메시지에 RATE_LIMITED를 넣어 클라이언트가 "요청이 너무 많습니다"로 보여 준다 (joinErrors.ts)
 */
export function installMatchmakeLimit(perMinute: number, now: () => number = Date.now): IpWindowLimiter {
  const limiter = new IpWindowLimiter(perMinute);
  const original = installed?.original ?? matchMaker.controller.invokeMethod;
  installed = { original };
  matchMaker.controller.invokeMethod = async function (method, roomName, clientOptions, authOptions) {
    if (method !== 'reconnect' && !limiter.allow(authOptions?.ip, now())) {
      throw new ServerError(HTTP_TOO_MANY_REQUESTS, 'RATE_LIMITED: too many matchmaking requests');
    }
    return original.call(this, method, roomName, clientOptions, authOptions);
  };
  return limiter;
}
