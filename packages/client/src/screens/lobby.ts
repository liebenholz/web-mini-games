import { NICKNAME_MAX, normalizeNickname, normalizeRoomCode } from '@wmg/rules';
import { h, svg } from '../dom.js';
import { dieSvg } from '../icons.js';
import { describeError, JoinError, type Session } from '../net.js';
import { saveNickname, savedNickname } from '../identity.js';

export interface LobbyActions {
  create(nickname: string): Promise<Session>;
  join(code: string, nickname: string): Promise<Session>;
  quickMatch(nickname: string): Promise<Session>;
  entered(session: Session): void;
}

/** 로비: 닉네임, 방 만들기, 코드로 입장, 랜덤 매칭 (명세 8장) */
export function renderLobby(
  actions: LobbyActions,
  inviteCode: string | null = null,
  notice: string | null = null,
): HTMLElement {
  const nickInput = h('input', {
    class: 'input',
    id: 'nickname',
    name: 'nickname',
    autocomplete: 'nickname',
    maxlength: NICKNAME_MAX,
    placeholder: '2~12자',
    value: savedNickname(),
    required: true,
  });
  const codeInput = h('input', {
    class: 'input input-code',
    id: 'room-code',
    name: 'room-code',
    inputmode: 'text',
    autocapitalize: 'characters',
    autocomplete: 'off',
    spellcheck: 'false',
    maxlength: 6,
    placeholder: 'ABC234',
    'aria-label': '방 코드',
    value: inviteCode ?? '',
  });
  const error = h('p', { class: 'error-text', role: 'alert' }, notice ?? '');
  const buttons: HTMLButtonElement[] = [];

  const busy = (on: boolean) => {
    for (const b of buttons) b.disabled = on;
  };

  const withNickname = async (run: (nickname: string) => Promise<Session>) => {
    const nickname = normalizeNickname(nickInput.value);
    if (!nickname) {
      error.textContent = describeError('INVALID_NICKNAME');
      nickInput.focus();
      return;
    }
    saveNickname(nickname);
    error.textContent = '';
    busy(true);
    try {
      actions.entered(await run(nickname));
    } catch (e) {
      error.textContent = describeError(e instanceof JoinError ? e.code : 'NETWORK');
      busy(false);
    }
  };

  const createBtn = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, '방 만들기');
  createBtn.addEventListener('click', () => void withNickname((n) => actions.create(n)));

  const joinBtn = h('button', { class: 'btn', type: 'submit' }, '입장');
  const joinForm = h(
    'form',
    { class: 'row', novalidate: true },
    h('div', { class: 'grow' }, codeInput),
    joinBtn,
  );
  joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const code = normalizeRoomCode(codeInput.value);
    if (!code) {
      error.textContent = '방 코드는 영문과 숫자 6자리입니다.';
      codeInput.focus();
      return;
    }
    void withNickname((n) => actions.join(code, n));
  });
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  const quickBtn = h('button', { class: 'btn btn-ghost btn-block', type: 'button' }, '아무 방에나 들어가기');
  quickBtn.addEventListener('click', () => void withNickname((n) => actions.quickMatch(n)));

  buttons.push(createBtn, joinBtn, quickBtn);

  const dice = h('div', { class: 'lobby-dice', 'aria-hidden': 'true' });
  // 파스텔 주사위 다섯 개 (장식)
  [1, 3, 3, 5, 6].forEach((f, i) => {
    dice.append(h('span', { class: `pip-die tone-${i + 1}` }, svg(dieSvg(f))));
  });

  const page = h(
    'main',
    { class: 'page narrow' },
    h(
      'header',
      { class: 'lobby-hero' },
      dice,
      h('h1', {}, '거짓말쟁이 주사위'),
      h(
        'p',
        { class: 'muted' },
        '내 주사위만 보고, 판 위에 몇 개가 있는지 부르세요. 거짓말 같으면 "라이어!"',
      ),
    ),
    h('div', { class: 'field' }, h('label', { for: 'nickname' }, '닉네임'), nickInput),
    inviteCode
      ? h('div', { class: 'stack' }, h('p', { class: 'muted' }, `초대받은 방 ${inviteCode}`), joinForm)
      : h(
          'div',
          { class: 'stack' },
          createBtn,
          h('div', { class: 'or' }, '또는 코드로 입장'),
          joinForm,
          quickBtn,
        ),
    error,
    h('p', { class: 'hint' }, '가입 없이 이 브라우저에 닉네임만 저장합니다. 빈자리는 봇이 채웁니다.'),
  );
  queueMicrotask(() => (inviteCode && savedNickname() ? joinBtn : nickInput).focus());
  return page;
}
