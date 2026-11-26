/**
 * 클라이언트 오류 보고 (docs/specs/client-errors.md).
 * 처리되지 않은 오류와 접속 실패를 서버 POST /client-error로 보낸다. 게스트 ID, 닉네임, 방 코드는 보내지 않는다.
 */
import {
  sanitizeErrorMessage,
  type ClientErrorKind,
  type ClientErrorReport,
  type ClientPlatform,
  type ClientRoute,
} from '@wmg/rules';
import { httpBase } from './statsApi.js';

/** CE-04: 한 번 연 화면에서 보내는 최대 건수 */
export const MAX_REPORTS_PER_PAGE = 10;

export interface ErrorContext {
  readonly route: ClientRoute;
  /** 서버 방 종류 (liars_dice …). 게임 밖이면 null */
  readonly game: string | null;
}

type Send = (report: ClientErrorReport) => void;

let context: () => ErrorContext = () => ({ route: 'hub', game: null });
let send: Send = (report) => {
  // keepalive: 화면을 떠나는 중에도 보낸다. 실패해도 다시 보내지 않는다 (CE-04)
  fetch(`${httpBase()}/client-error`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
    keepalive: true,
  }).catch(() => {});
};
const sent = new Set<string>();

/** CE-02: 빌드 커밋 앞 7자. 형식이 맞지 않으면 'dev' */
export function release(): string {
  // CI는 커밋 해시 전체(40자)를 넣는다
  const value = ((import.meta.env.VITE_APP_RELEASE as string | undefined) ?? '').slice(0, 7);
  return /^[0-9a-z]{1,7}$/.test(value) ? value : 'dev';
}

/** CE-02: User-Agent에서 기기 종류만 고른다 */
export function platformOf(userAgent: string, touchPoints = 0): ClientPlatform {
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)) return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  if (/Windows|Macintosh|Linux|CrOS/.test(userAgent)) return 'desktop';
  return 'other';
}

/** CE-01~CE-04: 오류 하나를 보낸다. 같은 종류·문구는 한 번만, 화면마다 최대 10건 */
export function reportClientError(kind: ClientErrorKind, raw: unknown): void {
  try {
    const message = sanitizeErrorMessage(raw);
    const key = `${kind}\u0000${message}`;
    if (sent.has(key) || sent.size >= MAX_REPORTS_PER_PAGE) return;
    sent.add(key);
    const { route, game } = context();
    send({
      kind,
      message,
      game,
      route,
      release: release(),
      platform: platformOf(navigator.userAgent, navigator.maxTouchPoints),
    });
  } catch {
    // 보고 때문에 화면이 깨지면 안 된다
  }
}

/** main.ts에서 한 번 부른다. 지금 화면 정보와 전역 오류 처리기를 건다 */
export function installErrorReports(getContext: () => ErrorContext): void {
  context = getContext;
  window.addEventListener('error', (event) => {
    // 다른 출처 스크립트(확장 프로그램 등)의 오류는 내용 없이 'Script error.'로만 온다
    if (!event.filename && /^Script error\.?$/.test(event.message)) return;
    reportClientError('js_error', event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportClientError('promise_rejection', event.reason);
  });
}

/**
 * CE-01 reconnect_failed: 연결이 끊긴 뒤 다시 붙지 못하고 방을 떠났을 때.
 * 각 게임 세션이 방을 만든 직후 부른다
 */
export function watchReconnect(room: {
  onDrop(cb: () => void): unknown;
  onReconnect(cb: () => void): unknown;
  onLeave(cb: (code: number) => void): unknown;
}): void {
  let dropped = false;
  room.onDrop(() => {
    dropped = true;
  });
  room.onReconnect(() => {
    dropped = false;
  });
  room.onLeave((code) => {
    if (!dropped) return;
    // 닫힘 코드는 4자리라 CE-03에서 지워지므로 범주로 보낸다
    const kind = code === 1000 ? 'normal' : code === 1006 ? 'abnormal' : code >= 4000 ? 'server' : 'other';
    reportClientError('reconnect_failed', `left after drop (${kind} close)`);
  });
}

/** 테스트 전용: 보내기를 바꾸고 기록을 비운다 */
export function _resetForTest(fn: Send, getContext?: () => ErrorContext): void {
  send = fn;
  sent.clear();
  if (getContext) context = getContext;
}
