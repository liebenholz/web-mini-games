import type { ClientErrorReport } from '@wmg/rules';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetForTest,
  MAX_REPORTS_PER_PAGE,
  platformOf,
  release,
  reportClientError,
  watchReconnect,
} from '../src/errorReport.js';

let sent: ClientErrorReport[] = [];

beforeEach(() => {
  sent = [];
  _resetForTest(
    (r) => void sent.push(r),
    () => ({ route: 'room', game: 'gomoku' }),
  );
});

describe('클라이언트 오류 보고 (docs/specs/client-errors.md)', () => {
  it('CE-02, CE-03: 화면 정보와 정리한 문구만 보낸다', () => {
    reportClientError('js_error', new Error('failed at https://x.test/gomoku/r/AB2CD3?t=1 after 12345ms'));
    expect(sent).toEqual([
      {
        kind: 'js_error',
        message: 'failed at https://x.test/gomoku/r/XXXXXX after #ms',
        game: 'gomoku',
        route: 'room',
        release: 'dev',
        platform: expect.any(String),
      },
    ]);
    expect(JSON.stringify(sent)).not.toContain('AB2CD3');
  });

  it('CE-04: 같은 종류·문구는 한 번만, 화면마다 최대 10건', () => {
    reportClientError('js_error', 'same');
    reportClientError('js_error', 'same');
    reportClientError('promise_rejection', 'same');
    expect(sent).toHaveLength(2);
    for (let i = 0; i < 20; i += 1) reportClientError('js_error', `e-${'x'.repeat(i)}`);
    expect(sent).toHaveLength(MAX_REPORTS_PER_PAGE);
  });

  it('CE-01 reconnect_failed: 끊긴 뒤 다시 붙지 못하고 떠났을 때만 보낸다', () => {
    const handlers: { drop?: () => void; back?: () => void; leave?: (code: number) => void } = {};
    const room = () => ({
      onDrop: (cb: () => void) => (handlers.drop = cb),
      onReconnect: (cb: () => void) => (handlers.back = cb),
      onLeave: (cb: (code: number) => void) => (handlers.leave = cb),
    });
    watchReconnect(room());
    handlers.leave?.(1000);
    expect(sent).toHaveLength(0);

    watchReconnect(room());
    handlers.drop?.();
    handlers.back?.();
    handlers.leave?.(4000);
    expect(sent).toHaveLength(0);

    watchReconnect(room());
    handlers.drop?.();
    handlers.leave?.(1006);
    expect(sent).toEqual([
      expect.objectContaining({ kind: 'reconnect_failed', message: 'left after drop (abnormal close)' }),
    ]);
  });

  it('CE-02: User-Agent에서 기기 종류만 고른다', () => {
    expect(platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('ios');
    expect(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('ios');
    expect(platformOf('Mozilla/5.0 (Linux; Android 15; SM-S928N)')).toBe('android');
    expect(platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('desktop');
    expect(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('desktop');
    expect(platformOf('curl/8.0')).toBe('other');
  });

  it('CE-02: 빌드 정보가 없으면 dev', () => {
    expect(release()).toBe('dev');
  });
});
