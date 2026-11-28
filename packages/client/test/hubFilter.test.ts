import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/games/catalog.js';
import {
  categoryCounts,
  filterGames,
  hubQueryString,
  normalizeQuery,
  parseHubQuery,
  splitHighlight,
} from '../src/screens/hubFilter.js';

const ids = (q: Parameters<typeof filterGames>[1]) => filterGames(CATALOG, q).map((g) => g.id);

describe('메인 화면 검색·필터 (순수 계산)', () => {
  it('아무 조건이 없으면 전체', () => {
    expect(ids({ q: '', c: '' })).toHaveLength(CATALOG.length);
    expect(ids({ q: '   ', c: '' })).toHaveLength(CATALOG.length);
  });

  it('카테고리 칩: 그 카테고리 게임만', () => {
    expect(ids({ q: '', c: 'party' })).toEqual(['updown-bomb', 'balloon', 'treasure']);
    expect(ids({ q: '', c: 'board' })).toEqual(['gomoku', 'reversi']);
    expect(ids({ q: '', c: 'dice' })).toEqual(['liars-dice', 'yacht']);
  });

  it('검색: 이름, 한 줄 소개, 카테고리 이름에서 찾는다', () => {
    expect(ids({ q: '오목', c: '' })).toEqual(['gomoku']);
    expect(ids({ q: '풍선', c: '' })).toEqual(['balloon']);
    // 한 줄 소개에만 있는 낱말
    expect(ids({ q: '스트라이크', c: '' })).toEqual(['bulls-and-cows']);
    // 카테고리 이름
    expect(ids({ q: '파티', c: '' })).toEqual(['updown-bomb', 'balloon', 'treasure']);
    expect(ids({ q: '주사위', c: '' })).toContain('liars-dice');
  });

  it('띄어 쓴 낱말은 모두 들어 있어야 하고, 칩과 함께 쓴다', () => {
    expect(ids({ q: '숫자 폭탄', c: '' })).toEqual(['updown-bomb']);
    expect(ids({ q: '당첨', c: 'party' })).toHaveLength(3);
    expect(ids({ q: '오목', c: 'party' })).toEqual([]);
    expect(ids({ q: '체스', c: '' })).toEqual([]);
  });

  it('영문은 대소문자를 가리지 않는다', () => {
    const games = [{ name: 'Gomoku Pro', tagline: '', category: 'board' as const }];
    expect(filterGames(games, { q: 'gOMOKU', c: '' })).toHaveLength(1);
  });

  it('칩 옆 게임 수', () => {
    const c = categoryCounts(CATALOG);
    expect(c['']).toBe(CATALOG.length);
    expect(c.party).toBe(3);
    expect(c.board + c.card + c.dice + c.number + c.party).toBe(CATALOG.length);
  });
});

describe('주소의 필터 상태', () => {
  it('읽기: 모르는 카테고리는 버리고, 검색어는 40자까지', () => {
    expect(parseHubQuery('?q=오목&c=board')).toEqual({ q: '오목', c: 'board' });
    expect(parseHubQuery('?c=nope')).toEqual({ q: '', c: '' });
    expect(parseHubQuery('')).toEqual({ q: '', c: '' });
    expect(parseHubQuery(`?q=${'가'.repeat(60)}`).q).toHaveLength(40);
  });

  it('쓰기: 비어 있으면 아무것도 붙이지 않고, 값은 안전하게 인코딩', () => {
    expect(hubQueryString({ q: '', c: '' })).toBe('');
    expect(hubQueryString({ q: '  ', c: '' })).toBe('');
    expect(hubQueryString({ q: '', c: 'party' })).toBe('?c=party');
    const s = hubQueryString({ q: '주사위 & 카드', c: 'card' });
    expect(parseHubQuery(s)).toEqual({ q: '주사위 & 카드', c: 'card' });
  });

  it('정리: NFC, 소문자, 공백', () => {
    expect(normalizeQuery('  ABC   가 ')).toBe('abc 가');
  });
});

describe('맞는 글자 표시', () => {
  it('검색어가 없으면 한 조각', () => {
    expect(splitHighlight('오목', '')).toEqual([{ text: '오목', hit: false }]);
  });

  it('맞는 부분만 표시하고 겹치는 범위는 합친다', () => {
    expect(splitHighlight('거짓말쟁이 주사위', '주사위')).toEqual([
      { text: '거짓말쟁이 ', hit: false },
      { text: '주사위', hit: true },
    ]);
    expect(splitHighlight('업다운 숫자폭탄', '숫자 자폭')).toEqual([
      { text: '업다운 ', hit: false },
      { text: '숫자폭', hit: true },
      { text: '탄', hit: false },
    ]);
    expect(splitHighlight('abAB', 'ab').map((p) => p.hit)).toEqual([true]);
    expect(splitHighlight('오목', '체스')).toEqual([{ text: '오목', hit: false }]);
  });
});
