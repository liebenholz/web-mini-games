import { NICKNAME_MAX, normalizeNickname, normalizeRoomCode } from '@wmg/rules';
import { h, svg } from '../dom.js';
import type { GameInfo } from '../games/registry.js';
import { boardStonesSvg, cardTileSvg, dieSvg, icons, textTileSvg } from '../icons.js';
import type { GameSession } from '../games/flow.js';
import { describeError, JoinError } from '../joinErrors.js';
import { saveNickname, savedNickname } from '../identity.js';
import { rulesButton } from './rulesSheet.js';

export interface LobbyActions {
  create(nickname: string): Promise<GameSession>;
  join(code: string, nickname: string): Promise<GameSession>;
  quickMatch(nickname: string): Promise<GameSession>;
  entered(session: GameSession): void;
  /** 메인(게임 목록)으로 */
  back(): void;
}

/** 게임 로비: 닉네임(모든 게임 공용), 방 만들기, 코드로 입장, 랜덤 매칭 (명세 8장, ADR 0002) */
export function renderLobby(
  game: GameInfo,
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

  const withNickname = async (run: (nickname: string) => Promise<GameSession>) => {
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
  // 파스텔 장식 다섯 개: 판 게임은 판 위 돌 1→5개, 카드 게임은 카드 모양, 나머지는 주사위
  heroIcons(game).forEach((icon, i) => {
    dice.append(h('span', { class: `pip-die tone-${i + 1}` }, svg(icon)));
  });

  const back = h(
    'button',
    { class: 'btn btn-ghost back-link', type: 'button' },
    svg(icons.back),
    '게임 목록',
  );
  back.addEventListener('click', () => actions.back());

  const page = h(
    'main',
    { class: 'page narrow' },
    h('nav', { class: 'lobby-nav', 'aria-label': '이동' }, back),
    h(
      'header',
      { class: 'lobby-hero' },
      dice,
      h('h1', {}, game.name),
      h('p', { class: 'muted' }, game.lead),
      // 처음 온 사람이 닉네임을 넣기 전에 규칙을 볼 수 있게 소개 바로 아래에 둔다
      game.rules ? h('div', {}, rulesButton(game.rules)) : null,
    ),
    h('div', { class: 'field' }, h('label', { for: 'nickname', class: 'field-label' }, '닉네임'), nickInput),
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
    // 저장 위치를 사실대로 알린다: 브라우저(localStorage)와 서버 판 기록(players, game_players) 둘 다
    h(
      'p',
      { class: 'hint', 'data-testid': 'storage-notice' },
      '가입 없이 이용합니다. 닉네임과 무작위로 만든 이용자 ID를 이 브라우저와 게임 서버의 판 기록에 저장합니다. 빈자리는 봇이 채웁니다.',
    ),
  );
  queueMicrotask(() => (inviteCode && savedNickname() ? joinBtn : nickInput).focus());
  return page;
}

/** 로비 머리 장식 아이콘 (게임 종류별) */
export function heroIcons(game: Pick<GameInfo, 'category'>): string[] {
  if (game.category === 'board') return [1, 2, 3, 4, 5].map(boardStonesSvg);
  if (game.category === 'card') return ['♠', '♥', '◆', '♣', '★'].map(cardTileSvg);
  if (game.category === 'number') return ['1', '2', '3', 'S', 'B'].map(textTileSvg);
  if (game.category === 'party')
    return [icons.bomb, textTileSvg('↑'), textTileSvg('?'), textTileSvg('↓'), icons.bomb];
  return [1, 3, 3, 5, 6].map((f) => dieSvg(f));
}
