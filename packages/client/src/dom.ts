type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;
type Child = Node | string | null | undefined | false;

/** 작은 DOM 헬퍼. 프레임워크 없이 화면을 조립한다. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'style') {
      // CSP(style-src 'self')는 style 속성(setAttribute)을 막지만 CSSOM은 허용한다
      el.style.cssText = String(value);
      continue;
    }
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') {
      el.className = String(value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

/** 신뢰할 수 있는(코드에 정의한) SVG 문자열만 넣는다. 사용자 입력을 넘기지 말 것 */
export function svg(markup: string): SVGElement {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  return template.content.firstElementChild as SVGElement;
}

let toastTimer: number | undefined;
export function toast(message: string): void {
  const host = document.getElementById('toast');
  if (!host) return;
  host.replaceChildren(h('div', { class: 'msg' }, message));
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => host.replaceChildren(), 2600);
}

export function mount(node: Node): void {
  document.getElementById('app')?.replaceChildren(node);
}
