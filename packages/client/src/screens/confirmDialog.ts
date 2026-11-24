import { h, svg } from '../dom.js';

export interface ConfirmOptions {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  /** 되돌릴 수 없는 행동(추방 등)이면 빨간 버튼 */
  readonly danger?: boolean;
  /** 제목 위 동그란 아이콘 (코드에 정의한 SVG만) */
  readonly icon?: string;
}

/**
 * 가운데 확인 팝업. 취소(기본 포커스) / 확인 중 하나를 고른다.
 * 바깥을 누르거나 ESC를 누르면 취소다. 닫히면 연 버튼으로 포커스를 돌려준다.
 */
export function confirmDialog(options: ConfirmOptions, trigger: HTMLElement | null = null): Promise<boolean> {
  return new Promise((resolve) => {
    const cancel = h('button', { class: 'btn', type: 'button' }, options.cancelLabel ?? '취소');
    const ok = h(
      'button',
      {
        class: `btn ${options.danger ? 'btn-danger' : 'btn-primary'}`,
        type: 'button',
        'data-testid': 'confirm-ok',
      },
      options.confirmLabel,
    );
    const dialog = h(
      'div',
      {
        class: 'confirm-dialog',
        role: 'alertdialog',
        'aria-modal': 'true',
        'aria-labelledby': 'confirm-title',
        'aria-describedby': 'confirm-body',
      },
      options.icon
        ? h(
            'span',
            { class: `confirm-icon${options.danger ? ' danger' : ''}`, 'aria-hidden': 'true' },
            svg(options.icon),
          )
        : null,
      h('h2', { id: 'confirm-title' }, options.title),
      h('p', { id: 'confirm-body', class: 'muted' }, options.body),
      h('div', { class: 'confirm-actions' }, cancel, ok),
    );
    const backdrop = h('div', { class: 'confirm-backdrop' }, dialog);
    const close = (result: boolean) => {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      if (trigger?.isConnected) trigger.focus();
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Tab') {
        // 두 버튼 사이에서만 포커스가 돈다
        e.preventDefault();
        (document.activeElement === cancel ? ok : cancel).focus();
      }
    };
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(false);
    });
    cancel.addEventListener('click', () => close(false));
    ok.addEventListener('click', () => close(true));
    document.addEventListener('keydown', onKey);
    document.body.append(backdrop);
    cancel.focus();
  });
}
