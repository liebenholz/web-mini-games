import { h, svg } from '../dom.js';
import { icons } from '../icons.js';
import { invitePath } from '../routes.js';
import { confirmKick, copy, roomCodeView, seatItem } from './waitingParts.js';

/** 대기실 틀이 보는 참가자 값 (게임마다 공유 상태에서 같은 이름으로 온다) */
export interface WaitingPlayer {
  readonly id: string;
  readonly nickname: string;
  readonly isBot: boolean;
  readonly isHost: boolean;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly spectator: boolean;
}

/** 대기실에서 보내는 공통 메시지 */
export interface WaitingSender {
  send(type: 'set_ready', payload: { ready: boolean }): void;
  send(type: 'start_game' | 'add_bot', payload: Record<string, never>): void;
  send(type: 'remove_bot' | 'kick_player', payload: { playerId: string }): void;
}

export interface WaitingShell {
  readonly session: WaitingSender;
  readonly me: string;
  readonly role: 'player' | 'spectator';
  readonly roomCode: string;
  readonly hostId: string;
  readonly players: readonly WaitingPlayer[];
  readonly fillWithBots: boolean;
  /** 주소에 쓰는 게임 이름 (초대 링크) */
  readonly gameId: string;
  /** 앉을 수 있는 자리 수 */
  readonly maxSeats: number;
  /** 옵션 칸 id (요약을 누르면 이리로 스크롤) */
  readonly optionsId: string;
  /** 처음 보이는 곳의 옵션 한 줄 요약 */
  readonly summary: string;
  /** 게임 옵션 조작들. 방장이 아니면 각 조작이 스스로 잠긴다 */
  readonly optionControls: readonly (HTMLElement | null)[];
  readonly onLeave: () => void;
}

/**
 * 게임 공통 대기실 (ADR 0003). 좌석, 방 코드·초대 링크, 옵션 요약, 준비·시작은 같고
 * 게임은 옵션 조작과 요약만 넘긴다. 넓은 화면에서는 참가자와 옵션이 좌우로 나란히 보인다
 */
export function renderWaitingShell(w: WaitingShell): HTMLElement {
  const { session, me } = w;
  const isHost = w.hostId === me;
  const self = w.players.find((p) => p.id === me);
  const seated = w.players.filter((p) => !p.spectator);
  const humansNotReady = seated.filter((p) => !p.isBot && !p.isHost && !p.ready);

  const seats = h('ul', { class: 'seats', 'aria-label': '좌석' });
  seated.forEach((p, i) => {
    const onKick =
      isHost && !p.isBot && p.id !== me
        ? (trigger: HTMLElement) =>
            confirmKick(p.nickname, trigger, () => session.send('kick_player', { playerId: p.id }))
        : null;
    seats.append(
      seatItem(p, i, me, isHost && p.isBot, () => session.send('remove_bot', { playerId: p.id }), onKick),
    );
  });
  for (let i = seated.length; i < w.maxSeats; i += 1) {
    if (isHost && i === seated.length) {
      const add = h('button', { class: 'btn btn-soft', type: 'button' }, svg(icons.plus), '봇 추가');
      add.addEventListener('click', () => session.send('add_bot', {}));
      seats.append(h('li', { class: 'seat empty' }, add));
    } else {
      seats.append(h('li', { class: 'seat empty' }, w.fillWithBots ? '빈자리 · 시작하면 봇' : '빈자리'));
    }
  }

  const copyCode = h('button', { class: 'btn', type: 'button' }, svg(icons.copy), '코드 복사');
  copyCode.addEventListener('click', () => void copy(w.roomCode, '방 코드를 복사했습니다.'));
  const copyLink = h(
    'button',
    { class: 'btn btn-primary', type: 'button' },
    svg(icons.link),
    '초대 링크 복사',
  );
  copyLink.addEventListener(
    'click',
    () =>
      void copy(`${location.origin}${invitePath({ id: w.gameId }, w.roomCode)}`, '초대 링크를 복사했습니다.'),
  );
  const back = h('button', { class: 'btn btn-ghost', type: 'button' }, svg(icons.back), '나가기');
  back.addEventListener('click', w.onLeave);

  const options = h(
    'section',
    { class: 'card options', id: w.optionsId, 'aria-labelledby': 'options-title' },
    h(
      'div',
      { class: 'section-head' },
      h('h2', { id: 'options-title' }, '방 옵션'),
      !isHost ? h('span', { class: 'hint' }, '방장만 바꿀 수 있어요') : null,
    ),
    ...w.optionControls,
  );

  // 처음 보이는 곳의 옵션 요약 (누르면 옵션으로)
  const summary = h(
    'button',
    { class: 'options-summary', type: 'button', 'data-testid': 'options-summary' },
    h('span', {}, w.summary),
    h(
      'span',
      { class: 'options-jump' },
      svg(icons.chevronDown),
      isHost ? '아래로 내려 방 옵션 바꾸기' : '방 옵션 자세히 보기',
    ),
  );
  summary.addEventListener('click', () => {
    options.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
    options.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  });

  let action: HTMLElement;
  if (w.role === 'spectator' || self?.spectator) {
    action = h('p', { class: 'muted' }, '관전 중이에요. 다음 판에 자리가 나면 참가합니다.');
  } else if (isHost) {
    const count = w.fillWithBots ? w.maxSeats : seated.length;
    const start = h(
      'button',
      {
        class: 'btn btn-primary btn-block',
        type: 'button',
        disabled: humansNotReady.length > 0 || count < 2,
      },
      '게임 시작',
    );
    start.addEventListener('click', () => session.send('start_game', {}));
    const note =
      humansNotReady.length > 0
        ? `${humansNotReady.map((p) => p.nickname).join(', ')} 님의 준비를 기다리고 있어요`
        : count < 2
          ? w.maxSeats === 2
            ? '2명이 필요해요. 봇을 추가하거나 빈자리 채우기를 켜세요'
            : '2명 이상 필요해요. 봇을 추가하거나 빈자리 채우기를 켜세요'
          : seated.length < w.maxSeats
            ? '빈자리는 봇이 채워요'
            : '모두 준비됐어요';
    action = h('div', { class: 'dock-inner' }, h('p', { class: 'hint' }, note), start);
  } else {
    const ready = Boolean(self?.ready);
    const btn = h(
      'button',
      { class: `btn btn-block ${ready ? '' : 'btn-primary'}`, type: 'button' },
      ready ? '준비 취소' : '준비 완료',
    );
    btn.addEventListener('click', () => session.send('set_ready', { ready: !ready }));
    action = h(
      'div',
      { class: 'dock-inner' },
      h('p', { class: 'hint' }, ready ? '방장이 시작하기를 기다리고 있어요' : '준비가 되면 눌러 주세요'),
      btn,
    );
  }

  return h(
    'div',
    {},
    h(
      'main',
      { class: 'page has-dock' },
      h('div', { class: 'topbar' }, back),
      h(
        'section',
        { class: 'room-code', 'aria-label': '방 코드' },
        h('div', {}, h('span', { class: 'label' }, '방 코드'), roomCodeView(w.roomCode)),
        h('div', { class: 'actions-inline' }, copyCode, copyLink),
      ),
      h(
        'div',
        { class: 'waiting-grid' },
        h(
          'section',
          { class: 'card', 'aria-labelledby': 'seats-title' },
          h(
            'div',
            { class: 'section-head' },
            h('h2', { id: 'seats-title' }, '참가자'),
            h('span', { class: 'hint' }, `${seated.length} / ${w.maxSeats}`),
          ),
          seats,
          summary,
        ),
        options,
      ),
    ),
    h('div', { class: 'dock' }, action),
  );
}
