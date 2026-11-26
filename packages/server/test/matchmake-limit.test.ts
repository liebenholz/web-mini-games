import { matchMaker } from '@colyseus/core';
import { afterEach, describe, expect, it } from 'vitest';
import { installMatchmakeLimit, IpWindowLimiter } from '../src/framework/matchmakeLimit.js';

describe('방 만들기·입장 IP별 제한 (보안 점검 2026-11-27)', () => {
  it('IP마다 1분에 정한 수까지만 허용하고, 1분이 지나면 다시 센다', () => {
    const l = new IpWindowLimiter(3);
    expect([1, 2, 3, 4].map(() => l.allow('203.0.113.1', 0))).toEqual([true, true, true, false]);
    // 다른 IP는 따로 센다
    expect(l.allow('203.0.113.2', 10)).toBe(true);
    expect(l.allow('203.0.113.1', 59_999)).toBe(false);
    expect(l.allow('203.0.113.1', 60_000)).toBe(true);
  });

  it('0이면 끄고, IP를 모르면 막지 않는다', () => {
    const off = new IpWindowLimiter(0);
    for (let i = 0; i < 100; i += 1) expect(off.allow('203.0.113.1', 0)).toBe(true);
    const on = new IpWindowLimiter(1);
    expect(on.allow(undefined, 0)).toBe(true);
    expect(on.allow(undefined, 0)).toBe(true);
  });

  it('기억하는 IP 수에 상한이 있다 (메모리)', () => {
    const l = new IpWindowLimiter(5, 60_000, 100);
    for (let i = 0; i < 1000; i += 1) l.allow(`10.0.${Math.floor(i / 256)}.${i % 256}`, 0);
    expect(l.size).toBeLessThanOrEqual(100);
  });

  describe('매칭 요청에 걸기', () => {
    afterEach(() => {
      installMatchmakeLimit(0);
    });

    it('한도를 넘으면 429 RATE_LIMITED, 재접속은 세지 않는다', async () => {
      let t = 0;
      installMatchmakeLimit(2, () => t);
      const auth = { ip: '198.51.100.7', headers: new Headers() };
      const call = (method: string) => matchMaker.controller.invokeMethod(method, 'no_such_room', {}, auth);
      // 없는 방 종류라 원래 함수는 실패하지만, 제한에 걸린 경우와 오류가 다르다
      const rejected = async (method: string) => {
        try {
          await call(method);
          return 'ok';
        } catch (e) {
          return (e as { code?: number; message?: string }).code === 429 ? 'limited' : 'passed';
        }
      };
      expect(await rejected('create')).toBe('passed');
      expect(await rejected('joinById')).toBe('passed');
      expect(await rejected('create')).toBe('limited');
      expect(await rejected('reconnect')).toBe('passed');
      try {
        await call('create');
      } catch (e) {
        expect(String((e as Error).message)).toContain('RATE_LIMITED');
      }
      t = 60_000;
      expect(await rejected('create')).toBe('passed');
    });
  });
});
