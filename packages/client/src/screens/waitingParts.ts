import { h, svg, toast } from '../dom.js';
import { icons } from '../icons.js';
import { avatar } from './avatar.js';
import { confirmDialog } from './confirmDialog.js';

/** 대기실 공통 부품: 방 코드(가리기·복사), 옵션 버튼, 좌석, 추방 확인. 거짓말쟁이 주사위와 오목이 같이 쓴다 */

/** 방 코드 가리기 여부. 화면 공유·방송 때를 위해 사람마다 브라우저에 기억한다 (처음에는 보인다) */
const CODE_HIDDEN_KEY = 'wmg.roomCodeHidden';

function codeHidden(): boolean {
  try {
    return localStorage.getItem(CODE_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

function setCodeHidden(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(CODE_HIDDEN_KEY, '1');
    else localStorage.removeItem(CODE_HIDDEN_KEY);
  } catch {
    // 저장할 수 없으면 이번 화면에서만 바뀐다
  }
}

/** 방 코드 표시 + 가리기 버튼. 복사 버튼은 가림 여부와 상관없이 실제 코드를 쓴다 */
export function roomCodeView(code: string): HTMLElement {
  const text = h('span', { class: 'code', 'data-testid': 'room-code' });
  const toggle = h('button', {
    class: 'btn btn-ghost code-toggle',
    type: 'button',
    'data-testid': 'room-code-toggle',
  });
  const paint = () => {
    const hidden = codeHidden();
    text.textContent = hidden ? '••••••' : code;
    text.classList.toggle('masked', hidden);
    text.setAttribute('aria-label', hidden ? '방 코드 가려짐' : `방 코드 ${code.split('').join(' ')}`);
    toggle.replaceChildren(svg(hidden ? icons.eye : icons.eyeOff), hidden ? '보기' : '가리기');
    toggle.setAttribute('aria-pressed', String(hidden));
    toggle.setAttribute('aria-label', hidden ? '방 코드 보기' : '방 코드 가리기');
  };
  toggle.addEventListener('click', () => {
    setCodeHidden(!codeHidden());
    paint();
  });
  paint();
  return h('div', { class: 'code-row' }, text, toggle);
}

export async function copy(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast(text);
  }
}

export function segmented<T extends string | number>(
  label: string,
  values: readonly T[],
  current: T,
  editable: boolean,
  onPick: (v: T) => void,
  text: (v: T) => string = String,
) {
  const group = h('div', { class: 'segmented', role: 'group', 'aria-label': label });
  for (const v of values) {
    const b = h(
      'button',
      { type: 'button', 'aria-pressed': String(v === current), disabled: !editable },
      text(v),
    );
    b.addEventListener('click', () => onPick(v));
    group.append(b);
  }
  return h('div', { class: 'option' }, h('span', { class: 'label' }, label), group);
}

export function toggle(label: string, value: boolean, editable: boolean, onChange: (v: boolean) => void) {
  const id = `opt-${label.replace(/\s+/g, '-')}`;
  const sw = h('button', {
    type: 'button',
    class: 'switch',
    role: 'switch',
    id,
    'aria-checked': String(value),
    'aria-label': label,
    disabled: !editable,
  });
  sw.addEventListener('click', () => onChange(!value));
  return h('div', { class: 'option' }, h('label', { class: 'label', for: id }, label), sw);
}

/** 좌석 한 줄에 필요한 공개 정보 (두 게임 공통) */
export interface SeatPlayer {
  readonly id: string;
  readonly nickname: string;
  readonly isBot: boolean;
  readonly isHost: boolean;
  readonly ready: boolean;
  readonly connected: boolean;
}

export function seatItem(
  p: SeatPlayer,
  index: number,
  me: string,
  canRemove: boolean,
  onRemove: () => void,
  onKick: ((trigger: HTMLElement) => void) | null,
): HTMLElement {
  const meta = p.isBot ? '봇' : !p.connected ? '연결 끊김' : p.id === me ? '나' : '';
  const badge = p.isHost
    ? h('span', { class: 'badge badge-host' }, '방장')
    : p.isBot || p.ready
      ? h('span', { class: 'badge badge-ready' }, '준비')
      : h('span', { class: 'badge badge-wait' }, '대기');
  const remove = canRemove
    ? h(
        'button',
        { class: 'btn btn-seat-x btn-remove-bot', type: 'button', 'aria-label': `${p.nickname} 빼기` },
        svg(icons.close),
      )
    : null;
  remove?.addEventListener('click', onRemove);
  // 방장만, 사람 참가자에게: 상태 배지 오른쪽 빨간 X 추방 버튼 (E-15). 봇 빼기는 같은 자리의 회색 X
  const kick = onKick
    ? h(
        'button',
        {
          class: 'btn btn-seat-x btn-kick',
          type: 'button',
          'aria-label': `${p.nickname} 추방`,
          'data-testid': 'kick',
        },
        svg(icons.close),
      )
    : null;
  if (kick && onKick) kick.addEventListener('click', () => onKick(kick));
  return h(
    'li',
    { class: `seat ${p.id === me ? 'me' : ''}` },
    avatar(p, index),
    h(
      'div',
      { class: 'who' },
      h('span', { class: 'name' }, p.nickname),
      meta ? h('span', { class: 'meta' }, meta) : null,
    ),
    h('div', { class: 'badges' }, badge),
    remove,
    kick,
  );
}

/** E-15: 방장이 사람 참가자를 추방하기 전에 확인한다 */
export function confirmKick(nickname: string, trigger: HTMLElement, kick: () => void): void {
  void confirmDialog(
    {
      title: `${nickname} 님을 추방할까요?`,
      body: '추방하면 이 방에서 바로 나가고, 이 방에는 다시 들어올 수 없어요.',
      confirmLabel: '추방',
      danger: true,
      icon: icons.userX,
    },
    trigger,
  ).then((yes) => {
    if (yes) kick();
  });
}
