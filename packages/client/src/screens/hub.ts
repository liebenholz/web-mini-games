import { h, svg } from '../dom.js';
import { SITE } from '../games/catalog.js';
import type { GameCategory, GameInfo } from '../games/registry.js';
import { dieSvg, icons, textTileSvg } from '../icons.js';
import { openRulesSheet } from './rulesSheet.js';

const CATEGORY_ICON: Record<GameCategory, string> = {
  dice: dieSvg(5, ''),
  card: icons.cards,
  board: icons.board,
  number: textTileSvg('#'),
};

/** 카테고리마다 파스텔 톤 하나 (Phase 3 카테고리 화면에서도 같은 색을 쓴다) */
const CATEGORY_TONE: Record<GameCategory, number> = { dice: 1, board: 2, card: 3, number: 4 };

function gameCard(game: GameInfo, onOpen: (game: GameInfo) => void): HTMLElement {
  const available = game.status === 'available';
  const icon = h(
    'span',
    { class: `game-icon tone-${CATEGORY_TONE[game.category]}`, 'aria-hidden': 'true' },
    svg(CATEGORY_ICON[game.category]),
  );
  const title = h('span', { class: 'game-name' }, game.name);
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
      h('span', { class: 'game-tagline' }, game.tagline),
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

/** 메인: 게임만 고른다. 닉네임과 방 코드는 게임 로비에서 정한다 (ADR 0002) */
export function renderHub(games: readonly GameInfo[], onOpen: (game: GameInfo) => void): HTMLElement {
  const list = h('ul', { class: 'game-list', 'aria-label': '게임 목록' });
  // 플레이할 수 있는 게임을 먼저, 준비 중인 게임은 뒤에
  for (const game of [...games].sort(
    (a, b) => Number(a.status !== 'available') - Number(b.status !== 'available'),
  ))
    list.append(gameCard(game, onOpen));
  return h(
    'main',
    { class: 'page narrow hub' },
    h(
      'header',
      { class: 'hub-hero' },
      h('p', { class: 'eyebrow' }, SITE.name),
      h('h1', {}, SITE.fullName),
      h('p', { class: 'muted' }, SITE.description),
    ),
    list,
  );
}
