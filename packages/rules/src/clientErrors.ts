/**
 * 클라이언트 오류 수집 (docs/specs/client-errors.md). 브라우저와 서버가 같은 검증과 문구 정리를 쓴다.
 */

/** CE-01 */
export const CLIENT_ERROR_KINDS = [
  'js_error',
  'promise_rejection',
  'connect_failed',
  'reconnect_failed',
] as const;
export type ClientErrorKind = (typeof CLIENT_ERROR_KINDS)[number];

/** CE-02: 오류가 난 화면 종류 */
export const CLIENT_ROUTES = ['hub', 'stats', 'lobby', 'room'] as const;
export type ClientRoute = (typeof CLIENT_ROUTES)[number];

/** CE-02: 기기 종류. 전체 User-Agent는 보내지 않는다 */
export const CLIENT_PLATFORMS = ['ios', 'android', 'desktop', 'other'] as const;
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number];

export const MAX_ERROR_MESSAGE = 200;

export interface ClientErrorReport {
  readonly kind: ClientErrorKind;
  readonly message: string;
  /** 게임 id (liars_dice …). 게임 밖 화면이면 null */
  readonly game: string | null;
  readonly route: ClientRoute;
  /** 클라이언트 빌드 커밋 앞 7자, 로컬 빌드는 'dev' */
  readonly release: string;
  readonly platform: ClientPlatform;
}

/**
 * CE-03: URL의 쿼리와 # 뒤, 방 코드 모양(영문 대문자·숫자 6자), 4자리 이상 숫자를 지우고 200자에서 자른다.
 * 브라우저가 보내기 전에 한 번, 서버가 받은 뒤 한 번 더 한다 (CE-05)
 */
export function sanitizeErrorMessage(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : String(raw ?? '');
  return text
    .replace(/(\bhttps?:\/\/[^\s?#]*)[?#]\S*/g, '$1')
    .replace(/\b[A-Z0-9]{6}\b/g, 'XXXXXX')
    .replace(/\d{4,}/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ERROR_MESSAGE);
}

const GAME_PATTERN = /^[a-z][a-z_]{0,31}$/;
const RELEASE_PATTERN = /^[0-9a-z]{1,12}$/;

const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

/** CE-05: 신뢰할 수 없는 보고를 검증한다. 틀리면 null. 문구는 다시 정리한다 */
export function parseClientErrorReport(input: unknown): ClientErrorReport | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const r = input as Record<string, unknown>;
  if (!oneOf(CLIENT_ERROR_KINDS, r.kind)) return null;
  if (!oneOf(CLIENT_ROUTES, r.route)) return null;
  if (!oneOf(CLIENT_PLATFORMS, r.platform)) return null;
  if (typeof r.message !== 'string' || r.message.length > 2000) return null;
  if (r.game !== null && (typeof r.game !== 'string' || !GAME_PATTERN.test(r.game))) return null;
  if (typeof r.release !== 'string' || !RELEASE_PATTERN.test(r.release)) return null;
  return {
    kind: r.kind,
    message: sanitizeErrorMessage(r.message),
    game: r.game,
    route: r.route,
    release: r.release,
    platform: r.platform,
  };
}
