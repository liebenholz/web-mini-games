/**
 * Cloudflare Pages `_headers` 내용 (보안 점검 2026-11-27). 빌드(vite.config.ts)가 읽는 순수 함수라 DOM을 쓰지 않는다.
 * 게임 서버 주소는 빌드 때 VITE_SERVER_URL로만 들어오므로 CSP의 connect-src도 그 값으로 만든다
 * (저장소에 실제 서버 주소를 적지 않는다, CLAUDE.md).
 */

/** Cloudflare Web Analytics: 스크립트는 static.cloudflareinsights.com, 수집은 cloudflareinsights.com/cdn-cgi/rum */
const ANALYTICS_SCRIPT = 'https://static.cloudflareinsights.com';
const ANALYTICS_BEACON = 'https://cloudflareinsights.com';

/** ws(s)://host → [https://host, wss://host]. 주소가 없거나 이상하면 빈 배열 */
export function serverOrigins(serverUrl: string | undefined): string[] {
  if (!serverUrl) return [];
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    return [];
  }
  const secure = url.protocol === 'wss:' || url.protocol === 'https:';
  const insecure = url.protocol === 'ws:' || url.protocol === 'http:';
  if (!secure && !insecure) return [];
  const host = url.host;
  return secure ? [`https://${host}`, `wss://${host}`] : [`http://${host}`, `ws://${host}`];
}

export function contentSecurityPolicy(serverUrl: string | undefined): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${ANALYTICS_SCRIPT}`,
    // 화면 코드는 style 속성 문자열을 쓰지 않고 CSSOM(el.style.x)만 쓴다
    "style-src 'self'",
    // Phaser가 기본 텍스처를 data: 주소로 만든다
    "img-src 'self' data: blob:",
    "font-src 'self'",
    ['connect-src', "'self'", ...serverOrigins(serverUrl), ANALYTICS_BEACON].join(' '),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // 다른 사이트가 iframe으로 덮어씌우지 못하게 (클릭재킹)
    "frame-ancestors 'none'",
  ].join('; ');
}

export function headersFile(serverUrl: string | undefined): string {
  return [
    '/*',
    `  Content-Security-Policy: ${contentSecurityPolicy(serverUrl)}`,
    '  X-Frame-Options: DENY',
    '  Strict-Transport-Security: max-age=31536000',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n');
}
