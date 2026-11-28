/** 직접 그린 1.75px 선 아이콘. 같은 굵기와 모서리로 통일한다. */
const wrap = (body: string) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  copy: wrap('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>'),
  link: wrap(
    '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  ),
  plus: wrap('<path d="M12 5v14M5 12h14"/>'),
  minus: wrap('<path d="M5 12h14"/>'),
  bot: wrap('<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01"/>'),
  close: wrap('<path d="M6 6l12 12M18 6L6 18"/>'),
  back: wrap('<path d="M15 6l-6 6 6 6"/>'),
  offline: wrap(
    '<path d="M3 3l18 18"/><path d="M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4-2.5M19 13a10 10 0 0 0-2.4-1.8M12 20h.01"/>',
  ),
  history: wrap('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>'),
  chevronRight: wrap('<path d="M9 6l6 6-6 6"/>'),
  chevronDown: wrap('<path d="M6 9l6 6 6-6"/>'),
  robot: wrap('<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01"/>'),
  wifiOff: wrap(
    '<path d="M3 3l18 18"/><path d="M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 4.2-2.6M14.8 10.3A10 10 0 0 1 19 12.9M2 9.4a15 15 0 0 1 4.3-2.9M12 20h.01"/>',
  ),
  cards: wrap(
    '<rect x="3" y="6" width="11" height="15" rx="2"/><path d="M8 3.5l1-.5 11 3.6a1.5 1.5 0 0 1 1 1.9L18 18"/>',
  ),
  board: wrap('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>'),
  /** 파티 게임 (업다운 숫자폭탄 등) */
  bomb: wrap(
    '<circle cx="10" cy="14" r="7"/><path d="M14.6 9.4l1.9-1.9 1.6 1.6-1.9 1.9"/><path d="M18 7l1.2-1.2M20.3 8.6l1.4.2M18.6 4.4l.2-1.4"/>',
  ),
  search: wrap('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  check: wrap('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16 10"/>'),
  arrowUp: wrap('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  arrowDown: wrap('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  eye: wrap('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: wrap(
    '<path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 4.4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  ),
  userX: wrap('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M17 8l4 4M21 8l-4 4"/>'),
  book: wrap(
    '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19"/><path d="M9 7h6"/>',
  ),
};

const PIPS: Record<number, Array<[number, number]>> = {
  1: [[12, 12]],
  2: [
    [8, 8],
    [16, 16],
  ],
  3: [
    [7, 7],
    [12, 12],
    [17, 17],
  ],
  4: [
    [8, 8],
    [16, 8],
    [8, 16],
    [16, 16],
  ],
  5: [
    [7, 7],
    [17, 7],
    [12, 12],
    [7, 17],
    [17, 17],
  ],
  6: [
    [8, 6.5],
    [16, 6.5],
    [8, 12],
    [16, 12],
    [8, 17.5],
    [16, 17.5],
  ],
};

/** 주사위 눈 SVG (선언 패널, 로비 장식용) */
export function dieSvg(face: number, label = `${face}`): string {
  const pips = (PIPS[face] ?? [])
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.9" fill="currentColor"/>`)
    .join('');
  return `<svg viewBox="0 0 24 24" role="img" aria-label="${label}"><rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/>${pips}</svg>`;
}

/** 판 위 돌 놓는 자리 (가운데 → 대각선 네 귀) */
const STONE_SPOTS: readonly (readonly [number, number])[] = [
  [12, 12],
  [8, 8],
  [16, 16],
  [16, 8],
  [8, 16],
];

/**
 * 오목 로비 장식: 3×3 판에 돌 count개 (1~5). 흑과 백을 번갈아 놓는다.
 * 흑은 currentColor, 백은 흰 바탕 + currentColor 테두리
 */
export function boardStonesSvg(count: number): string {
  const stones = STONE_SPOTS.slice(0, count)
    .map(([x, y], i) =>
      i % 2 === 0
        ? `<circle cx="${x}" cy="${y}" r="2.6" fill="currentColor"/>`
        : `<circle cx="${x}" cy="${y}" r="2.1" fill="#fff" stroke="currentColor" stroke-width="1.2"/>`,
    )
    .join('');
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4v16M12 4v16M16 4v16M4 8h16M4 12h16M4 16h16" stroke="currentColor" stroke-width="0.9" opacity="0.55"/>${stones}</svg>`;
}

/** 원카드 로비 장식: 카드 테두리 안에 모양 (♠ ♥ ◆ ♣ ★) */
export function cardTileSvg(symbol: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2.5" width="14" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="12" y="16" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor">${symbol}</text></svg>`;
}

/** 글자 하나를 넣은 둥근 사각형 (숫자야구 로비 장식: 1 2 3 S B) */
export function textTileSvg(text: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="2.5" width="19" height="19" rx="4" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="12" y="16.5" text-anchor="middle" font-size="12" font-weight="800" fill="currentColor">${text}</text></svg>`;
}

/** 업다운 당첨 화면의 큰 폭탄 (채운 그림, 64 단위) */
export function bombSvg(): string {
  return '<svg class="ud-bomb" viewBox="0 0 64 64" aria-hidden="true"><circle cx="28" cy="38" r="20" fill="currentColor"/><rect x="34" y="14" width="10" height="9" rx="2" transform="rotate(35 39 18)" fill="currentColor"/><path d="M44 12c3-5 8-5 10-2" fill="none" stroke="#f5a524" stroke-width="3" stroke-linecap="round"/><circle cx="56" cy="8" r="3.5" fill="#f5a524"/><circle cx="21" cy="31" r="5" fill="#fff" opacity=".35"/></svg>';
}
