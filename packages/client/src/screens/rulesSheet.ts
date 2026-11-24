import { h, svg } from '../dom.js';
import { icons } from '../icons.js';

let open: { backdrop: HTMLElement; trigger: HTMLElement | null; onKey: (e: KeyboardEvent) => void } | null =
  null;

export function closeRulesSheet(): void {
  if (!open) return;
  document.removeEventListener('keydown', open.onKey);
  open.backdrop.remove();
  document.body.classList.remove('sheet-open');
  if (open.trigger?.isConnected) open.trigger.focus();
  open = null;
}

/** 아래에서 올라오는 규칙 시트. 제목과 확인 버튼은 고정하고 본문만 스크롤한다 */
export function openRulesSheet(
  body: HTMLElement,
  trigger: HTMLElement | null = null,
  title = '게임 규칙',
): void {
  closeRulesSheet();
  const close = h(
    'button',
    { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': '닫기' },
    svg(icons.close),
  );
  const ok = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, '알겠어요');
  const sheet = h(
    'div',
    {
      class: 'rules-sheet',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'rules-title',
      'data-testid': 'rules-sheet',
    },
    h('span', { class: 'sheet-grabber', 'aria-hidden': 'true' }),
    h('div', { class: 'rules-head' }, h('h2', { id: 'rules-title' }, title), close),
    h('div', { class: 'rules-scroll', tabindex: '0', 'aria-label': '규칙 내용' }, body),
    h('div', { class: 'rules-foot' }, ok),
  );
  const backdrop = h('div', { class: 'recall-backdrop' }, sheet);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeRulesSheet();
  });
  close.addEventListener('click', closeRulesSheet);
  ok.addEventListener('click', closeRulesSheet);
  const focusables = [close, sheet.querySelector<HTMLElement>('.rules-scroll'), ok].filter(
    (el): el is HTMLElement => el !== null,
  );
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeRulesSheet();
      return;
    }
    // 시트 밖으로 포커스가 나가지 않게 한다 (aria-modal)
    if (e.key === 'Tab') {
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  document.body.classList.add('sheet-open');
  open = { backdrop, trigger, onKey };
  close.focus();
}

/** 로비 등에서 쓰는 "게임 규칙 보기" 버튼. 내용은 게임 목록(registry)이 준다 */
export function rulesButton(rules: () => HTMLElement, label = '게임 규칙 보기'): HTMLButtonElement {
  const btn = h(
    'button',
    { class: 'btn rules-btn', type: 'button', 'aria-haspopup': 'dialog', 'data-testid': 'rules-open' },
    svg(icons.book),
    label,
  );
  btn.addEventListener('click', () => openRulesSheet(rules(), btn));
  return btn;
}
