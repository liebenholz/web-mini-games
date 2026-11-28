import { h, svg } from '../dom.js';
import { CATEGORY_LABEL, CATEGORY_ORDER, SITE } from '../games/catalog.js';
import type { GameCategory, GameInfo } from '../games/registry.js';
import { dieSvg, icons, textTileSvg } from '../icons.js';
import {
  categoryCounts,
  filterGames,
  hubQueryString,
  parseHubQuery,
  splitHighlight,
  type HubQuery,
} from './hubFilter.js';
import { openRulesSheet } from './rulesSheet.js';

const CATEGORY_ICON: Record<GameCategory, string> = {
  dice: dieSvg(5, ''),
  card: icons.cards,
  board: icons.board,
  number: textTileSvg('#'),
  party: icons.bomb,
};

/** 카테고리마다 파스텔 톤 하나 (Phase 3 카테고리 화면에서도 같은 색을 쓴다) */
const CATEGORY_TONE: Record<GameCategory, number> = { dice: 1, board: 2, card: 3, number: 4, party: 6 };

/** 검색어와 맞는 글자를 <mark>로 감싼다 */
function marked(text: string, q: string): (Node | string)[] {
  return splitHighlight(text, q).map((p) => (p.hit ? h('mark', {}, p.text) : p.text));
}

function gameCard(game: GameInfo, onOpen: (game: GameInfo) => void, q = ''): HTMLElement {
  const available = game.status === 'available';
  const icon = h(
    'span',
    { class: `game-icon tone-${CATEGORY_TONE[game.category]}`, 'aria-hidden': 'true' },
    svg(CATEGORY_ICON[game.category]),
  );
  const title = h('span', { class: 'game-name' }, ...marked(game.name, q));
  const meta = h('span', { class: 'game-meta' }, `${game.players} · ${game.minutes}`);

  if (!available) {
    return h(
      'li',
      { class: 'game-card soon', 'data-testid': `game-${game.id}` },
      h(
        'div',
        { class: 'game-main', 'aria-disabled': 'true' },
        icon,
        h(
          'span',
          { class: 'game-text' },
          h('span', { class: 'game-title' }, title, h('span', { class: 'badge-soon' }, '준비 중')),
          meta,
        ),
      ),
    );
  }

  const open = h(
    'button',
    { class: 'game-main', type: 'button', 'aria-label': `${game.name} 하러 가기` },
    icon,
    h(
      'span',
      { class: 'game-text' },
      h('span', { class: 'game-title' }, title),
      meta,
      h('span', { class: 'game-tagline' }, ...marked(game.tagline, q)),
    ),
    h('span', { class: 'game-go', 'aria-hidden': 'true' }, svg(icons.chevronRight)),
  );
  open.addEventListener('click', () => onOpen(game));
  const children: (HTMLElement | null)[] = [open];
  if (game.rules) {
    const rules = game.rules;
    const btn = h(
      'button',
      {
        class: 'game-rules',
        type: 'button',
        'aria-haspopup': 'dialog',
        'aria-label': `${game.name} 규칙 보기`,
      },
      svg(icons.book),
      '규칙 보기',
    );
    btn.addEventListener('click', () => openRulesSheet(rules(), btn, `${game.name} 규칙`));
    children.push(btn);
  }
  return h('li', { class: 'game-card', 'data-testid': `game-${game.id}` }, ...children);
}

/**
 * 메인: 게임을 고른다. 닉네임과 방 코드는 게임 로비에서 정한다 (ADR 0002).
 * 게임이 8개를 넘어 검색창과 카테고리 칩을 둔다 (2026-11-28). 상태는 주소(?q=, ?c=)에 남긴다.
 */
export function renderHub(
  games: readonly GameInfo[],
  onOpen: (game: GameInfo) => void,
  initial: HubQuery = parseHubQuery(location.search),
): HTMLElement {
  let query: HubQuery = initial;
  // 플레이할 수 있는 게임을 먼저, 준비 중인 게임은 뒤에
  const sorted = [...games].sort(
    (a, b) => Number(a.status !== 'available') - Number(b.status !== 'available'),
  );
  const counts = categoryCounts(sorted);

  const input = h('input', {
    type: 'search',
    value: query.q,
    placeholder: '게임 이름이나 소개로 찾기',
    'aria-label': '게임 검색',
    autocomplete: 'off',
    maxlength: 40,
    enterkeyhint: 'search',
    'data-testid': 'hub-search',
  });
  const clear = h(
    'button',
    { class: 'clear', type: 'button', 'aria-label': '검색어 지우기', hidden: !query.q },
    svg(icons.close),
  );
  const box = h('div', { class: 'find-box' }, svg(icons.search), input, clear);

  const chipEls = new Map<string, HTMLButtonElement>();
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': '카테고리' });
  for (const key of ['', ...CATEGORY_ORDER] as const) {
    if (key !== '' && counts[key] === 0) continue;
    const chip = h(
      'button',
      { class: 'chip', type: 'button', 'aria-pressed': 'false', 'data-testid': `chip-${key || 'all'}` },
      key === '' ? '전체' : CATEGORY_LABEL[key],
      h('small', {}, String(counts[key])),
    );
    chip.addEventListener('click', () => update({ ...query, c: key === query.c ? '' : key }));
    chipEls.set(key, chip);
    chips.append(chip);
  }

  const status = h('p', { class: 'find-count', role: 'status', 'data-testid': 'hub-count' });
  const list = h('ul', { class: 'game-list', 'aria-label': '게임 목록' });
  const empty = h('div', { class: 'find-empty', role: 'status', 'data-testid': 'hub-empty' });

  function reset(): void {
    update({ q: '', c: '' });
    input.focus();
  }

  let first = true;
  function update(next: HubQuery): void {
    query = next;
    if (input.value !== query.q) input.value = query.q;
    clear.hidden = !query.q;
    for (const [key, el] of chipEls) el.setAttribute('aria-pressed', String(key === query.c));
    // 주소에 남긴다 (뒤로 가기·새로고침·공유). 같은 페이지 안의 바뀜이라 기록은 쌓지 않는다
    // 처음 그릴 때는 주소를 건드리지 않는다 (다른 쿼리 값을 지우지 않게)
    if (!first) history.replaceState(history.state, '', `${location.pathname}${hubQueryString(query)}`);
    first = false;
    const hits = filterGames(sorted, query);
    const filtering = Boolean(query.q.trim() || query.c);
    list.replaceChildren(...hits.map((g) => gameCard(g, onOpen, query.q)));
    list.hidden = hits.length === 0;
    empty.hidden = hits.length > 0;
    status.hidden = hits.length === 0;
    status.replaceChildren(h('span', {}, filtering ? `${hits.length}개 게임` : `게임 ${hits.length}개`));
    if (filtering) {
      const off = h('button', { type: 'button' }, '필터 지우기');
      off.addEventListener('click', reset);
      status.append(off);
    }
    if (hits.length === 0) {
      const off = h('button', { class: 'btn', type: 'button' }, '필터 지우기');
      off.addEventListener('click', reset);
      empty.replaceChildren(
        h('b', {}, '찾는 게임이 없어요'),
        query.q.trim() ? `"${query.q.trim()}"와(과) 맞는 게임이 없어요.` : '이 카테고리에는 게임이 없어요.',
        h('br'),
        off,
      );
    }
  }

  input.addEventListener('input', () => update({ ...query, q: input.value }));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) {
      e.preventDefault();
      reset();
    }
  });
  clear.addEventListener('click', reset);

  const page = h(
    'main',
    { class: 'page narrow hub' },
    h(
      'header',
      { class: 'hub-hero' },
      h('p', { class: 'eyebrow' }, SITE.name),
      h('h1', {}, SITE.fullName),
      h('p', { class: 'muted' }, SITE.description),
    ),
    h('div', { class: 'hub-find' }, box, chips),
    status,
    list,
    empty,
  );
  update(query);
  return page;
}
