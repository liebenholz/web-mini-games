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
