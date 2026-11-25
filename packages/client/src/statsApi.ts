import { kstDay, type StatsRange, type StatsResponse } from '@wmg/rules';
import { serverUrl } from './config.js';
import { guestId } from './identity.js';

/** 게임 서버 HTTP 주소 (ws → http, wss → https) */
export function httpBase(wsUrl: string = serverUrl()): string {
  return wsUrl.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, '');
}

const VISIT_KEY = 'wmg.visitDay';

/**
 * ST-01: 사이트를 연 날 한 번만 방문을 알린다 (한국 시간 날짜를 브라우저에 기억).
 * 실패해도 아무것도 하지 않는다. 다음 날이나 다음 방문에 다시 보낸다
 */
export function recordVisit(now: number = Date.now()): void {
  const today = kstDay(now);
  try {
    if (localStorage.getItem(VISIT_KEY) === today) return;
  } catch {
    // 저장소를 못 쓰면 열 때마다 보낸다. 서버가 같은 날 같은 게스트를 한 번만 센다
  }
  fetch(`${httpBase()}/visit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ guestId: guestId() }),
    keepalive: true,
  })
    .then((res) => {
      if (!res.ok) return;
      try {
        localStorage.setItem(VISIT_KEY, today);
      } catch {
        // 무시
      }
    })
    .catch(() => {});
}

export async function fetchStats(range: StatsRange): Promise<StatsResponse> {
  const res = await fetch(`${httpBase()}/stats?days=${range}`);
  if (!res.ok) throw new Error(`stats ${res.status}`);
  return (await res.json()) as StatsResponse;
}
