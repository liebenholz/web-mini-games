import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, headersFile, serverOrigins } from '../src/securityHeaders.js';

describe('보안 헤더 (_headers)', () => {
  it('게임 서버 주소에서 HTTP와 WebSocket 출처를 만든다', () => {
    expect(serverOrigins('wss://api.example.com')).toEqual([
      'https://api.example.com',
      'wss://api.example.com',
    ]);
    expect(serverOrigins('ws://localhost:2567')).toEqual(['http://localhost:2567', 'ws://localhost:2567']);
    expect(serverOrigins(undefined)).toEqual([]);
    expect(serverOrigins('not a url')).toEqual([]);
    expect(serverOrigins('ftp://x.example')).toEqual([]);
  });

  it('CSP: 자기 출처, 게임 서버, 분석 스크립트만 허용하고 iframe 삽입을 막는다', () => {
    const csp = contentSecurityPolicy('wss://api.example.com');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' https://static.cloudflareinsights.com");
    expect(csp).toContain(
      "connect-src 'self' https://api.example.com wss://api.example.com https://cloudflareinsights.com",
    );
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('모든 경로에 CSP, 프레임 차단, HSTS를 붙이고 정적 파일은 오래 캐시한다', () => {
    const file = headersFile('wss://api.example.com');
    expect(file.startsWith('/*\n')).toBe(true);
    for (const h of [
      'Content-Security-Policy:',
      'X-Frame-Options: DENY',
      'Strict-Transport-Security: max-age=31536000',
      'X-Content-Type-Options: nosniff',
      'Referrer-Policy: strict-origin-when-cross-origin',
    ])
      expect(file).toContain(h);
    expect(file).toContain('/assets/*\n  Cache-Control: public, max-age=31536000, immutable');
  });
});
