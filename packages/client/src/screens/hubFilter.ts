import { CATEGORY_LABEL, CATEGORY_ORDER, type GameCategory } from '../games/catalog.js';

/**
 * 메인 화면 검색·필터의 순수 계산 (2026-11-28). DOM을 쓰지 않아 단위 테스트가 쉽다.
 * 검색은 이름, 한 줄 소개, 카테고리 이름에서 찾고, 띄어 쓴 낱말은 모두 들어 있어야 한다 (AND).
 * 필터 상태는 주소(`/?q=…&c=party`)에 남겨 뒤로 가기, 새로고침, 링크 공유가 그대로 된다.
 */
export interface HubQuery {
  readonly q: string;
  readonly c: GameCategory | '';
}

export interface Searchable {
  readonly name: string;
  readonly tagline: string;
  readonly category: GameCategory;
}

/** 비교용으로 정리: NFC, 소문자, 앞뒤 공백 제거, 연속 공백 하나로 */
export function normalizeQuery(input: string): string {
  return input.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

const terms = (q: string): string[] => normalizeQuery(q).split(' ').filter(Boolean);

export function parseHubQuery(search: string): HubQuery {
  const params = new URLSearchParams(search);
  const q = (params.get('q') ?? '').slice(0, 40);
  const c = params.get('c') ?? '';
  return { q, c: CATEGORY_ORDER.find((k) => k === c) ?? '' };
}

/** 빈 값은 주소에 쓰지 않는다. 아무 필터도 없으면 '' */
export function hubQueryString(query: HubQuery): string {
  const params = new URLSearchParams();
  if (normalizeQuery(query.q)) params.set('q', query.q.trim());
  if (query.c) params.set('c', query.c);
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function filterGames<T extends Searchable>(games: readonly T[], query: HubQuery): T[] {
  const words = terms(query.q);
  return games.filter((g) => {
    if (query.c && g.category !== query.c) return false;
    if (words.length === 0) return true;
    const hay = normalizeQuery(`${g.name} ${g.tagline} ${CATEGORY_LABEL[g.category]}`);
    return words.every((w) => hay.includes(w));
  });
}

/** 칩 옆에 보여 주는 게임 수. '' 키는 전체 */
export function categoryCounts(games: readonly Searchable[]): Record<'' | GameCategory, number> {
  const out: Record<'' | GameCategory, number> = {
    '': games.length,
    party: 0,
    board: 0,
    card: 0,
    dice: 0,
    number: 0,
  };
  for (const g of games) out[g.category] += 1;
  return out;
}

export interface Piece {
  readonly text: string;
  readonly hit: boolean;
}

/** 검색어와 맞는 글자를 표시하려고 글을 조각낸다 (겹치는 범위는 합친다) */
export function splitHighlight(text: string, q: string): Piece[] {
  const words = terms(q);
  if (words.length === 0) return [{ text, hit: false }];
  const lower = text.normalize('NFC').toLowerCase();
  // 소문자로 바꿔도 길이가 달라지는 글자가 있으면 표시를 포기한다
  if (lower.length !== text.normalize('NFC').length) return [{ text, hit: false }];
  const base = text.normalize('NFC');
  const ranges: [number, number][] = [];
  for (const w of words) {
    let from = 0;
    for (;;) {
      const i = lower.indexOf(w, from);
      if (i < 0) break;
      ranges.push([i, i + w.length]);
      from = i + w.length;
    }
  }
  if (ranges.length === 0) return [{ text: base, hit: false }];
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const out: Piece[] = [];
  let pos = 0;
  for (const [a, b] of merged) {
    if (a > pos) out.push({ text: base.slice(pos, a), hit: false });
    out.push({ text: base.slice(a, b), hit: true });
    pos = b;
  }
  if (pos < base.length) out.push({ text: base.slice(pos), hit: false });
  return out;
}
