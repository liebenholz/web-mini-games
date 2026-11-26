import { describe, expect, it } from 'vitest';
import { axisTicks, labelIndexes, longDate, niceStep, shortDate } from '../src/statsChart.js';
import { httpBase } from '../src/statsApi.js';
import { CATALOG } from '../src/games/catalog.js';
import { parseRoute } from '../src/routes.js';

describe('통계 그래프 계산 (docs/specs/stats.md)', () => {
  it('눈금은 1·2·5 단위로, 값이 0이면 0~4', () => {
    expect(axisTicks(0)).toEqual([0, 1, 2, 3, 4]);
    expect(niceStep(7)).toBe(2);
    expect(axisTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(axisTicks(34)).toEqual([0, 10, 20, 30, 40]);
    expect(axisTicks(130)).toEqual([0, 50, 100, 150, 200]);
  });

  it('x축 이름은 처음과 끝을 포함해 고르게', () => {
    expect(labelIndexes(3, 4)).toEqual([0, 1, 2]);
    expect(labelIndexes(30, 4)).toEqual([0, 10, 19, 29]);
    expect(labelIndexes(0, 4)).toEqual([]);
  });

  it('날짜 표기', () => {
    expect(shortDate('2026-11-05')).toBe('11/5');
    expect(longDate('2026-11-25')).toBe('11월 25일 (수)');
  });

  it('게임 서버 HTTP 주소', () => {
    expect(httpBase('wss://api.example.com')).toBe('https://api.example.com');
    expect(httpBase('ws://localhost:2567/')).toBe('http://localhost:2567');
  });

  it('/stats 는 통계 화면', () => {
    const games = CATALOG.map((g) => ({ ...g, roomType: g.id, rules: null, loadFlow: null }));
    expect(parseRoute('/stats', games, 'liars-dice').kind).toBe('stats');
    expect(parseRoute('/stats/x', games, 'liars-dice').kind).toBe('not-found');
  });
});
