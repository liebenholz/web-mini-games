import { gomoku, TURN_SECONDS_CHOICES } from '@wmg/rules';
import { h, svg } from '../../dom.js';
import { icons } from '../../icons.js';
import { invitePath } from '../../routes.js';
import { confirmKick, copy, roomCodeView, seatItem, segmented, toggle } from '../../screens/waitingParts.js';
import type { GomokuOptionsView, GomokuSession, GomokuSnapshot } from './session.js';

const BLACK_LABEL: Record<gomoku.BlackPolicy, string> = { host: '방장', guest: '상대', random: '무작위' };

/** "흑(선): 무작위 · 금수 3-3·4-4·장목 · 턴 30초" (옵션 요약, 시안 1-a) */
export function optionsSummary(o: GomokuOptionsView): string {
  const forbidden = [
    o.forbidDoubleThree && '3-3',
    o.forbidDoubleFour && '4-4',
    o.forbidOverline && '장목',
  ].filter(Boolean);
  const rules = forbidden.length > 0 ? `금수 ${forbidden.join('·')}` : '금수 없음';
  return `흑(선): ${BLACK_LABEL[o.blackPolicy] ?? '무작위'} · ${rules} · 턴 ${o.turnSeconds}초`;
}

/**
 * 오목 대기실 (gomoku.md 8장). 옵션은 같은 화면 아래에 있다.
 * 처음 보이는 곳에는 현재 옵션 요약과 "아래로 내려 방 옵션 바꾸기"를 두고, 누르면 옵션으로 스크롤한다.
 * 넓은 화면에서는 참가자와 옵션이 좌우로 나란히 보인다.
 */
export function renderGomokuWaiting(
  session: GomokuSession,
  snap: GomokuSnapshot,
  onLeave: () => void,
): HTMLElement {
  const { view, me } = snap;
  const o = view.options;
  const isHost = view.hostId === me;
  const self = view.players.find((p) => p.id === me);
  const seated = view.players.filter((p) => !p.spectator);
  const humansNotReady = seated.filter((p) => !p.isBot && !p.isHost && !p.ready);
  const setOptions = (options: Partial<gomoku.GomokuRoomOptions>) => session.send('set_options', { options });

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
  for (let i = seated.length; i < gomoku.GOMOKU_PLAYERS; i += 1) {
    if (isHost && i === seated.length) {
      const add = h('button', { class: 'btn btn-soft', type: 'button' }, svg(icons.plus), '봇 추가');
      add.addEventListener('click', () => session.send('add_bot', {}));
      seats.append(h('li', { class: 'seat empty' }, add));
    } else {
      seats.append(h('li', { class: 'seat empty' }, o.fillWithBots ? '빈자리 · 시작하면 봇' : '빈자리'));
    }
  }

  const copyCode = h('button', { class: 'btn', type: 'button' }, svg(icons.copy), '코드 복사');
  copyCode.addEventListener('click', () => void copy(view.roomCode, '방 코드를 복사했습니다.'));
  const copyLink = h(
    'button',
    { class: 'btn btn-primary', type: 'button' },
    svg(icons.link),
    '초대 링크 복사',
  );
  copyLink.addEventListener(
    'click',
    () =>
      void copy(
        `${location.origin}${invitePath({ id: gomoku.GOMOKU_ROOM_TYPE }, view.roomCode)}`,
        '초대 링크를 복사했습니다.',
      ),
  );
  const back = h('button', { class: 'btn btn-ghost', type: 'button' }, svg(icons.back), '나가기');
  back.addEventListener('click', onLeave);

  const options = h(
    'section',
    { class: 'card options', id: 'gomoku-options', 'aria-labelledby': 'options-title' },
    h(
      'div',
      { class: 'section-head' },
      h('h2', { id: 'options-title' }, '방 옵션'),
      !isHost ? h('span', { class: 'hint' }, '방장만 바꿀 수 있어요') : null,
    ),
    segmented(
      '흑(선)은 누가',
      gomoku.BLACK_POLICIES,
      o.blackPolicy,
      isHost,
      (v) => setOptions({ blackPolicy: v }),
      (v) => BLACK_LABEL[v],
    ),
    h(
      'div',
      { class: 'option-group', role: 'group', 'aria-labelledby': 'forbid-title' },
      h('span', { class: 'label', id: 'forbid-title' }, '흑 금수 규칙'),
      toggle('3-3 금지', o.forbidDoubleThree, isHost, (v) => setOptions({ forbidDoubleThree: v })),
      toggle('4-4 금지', o.forbidDoubleFour, isHost, (v) => setOptions({ forbidDoubleFour: v })),
      toggle('장목(6목 이상) 금지', o.forbidOverline, isHost, (v) => setOptions({ forbidOverline: v })),
      h('p', { class: 'hint' }, '모두 끄면 자유 오목. 백에게는 금수가 없어요.'),
    ),
    segmented('턴 제한(초) · 넘기면 시간패', TURN_SECONDS_CHOICES, o.turnSeconds, isHost, (v) =>
      setOptions({ turnSeconds: v }),
    ),
    toggle('빈자리 봇으로 채우기', o.fillWithBots, isHost, (v) => setOptions({ fillWithBots: v })),
    toggle('비공개 방', o.isPrivate, isHost, (v) => setOptions({ isPrivate: v })),
  );

  // 처음 보이는 곳의 옵션 요약 (누르면 옵션으로)
  const summary = h(
    'button',
    { class: 'options-summary', type: 'button', 'data-testid': 'options-summary' },
    h('span', {}, optionsSummary(o)),
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
  if (snap.role === 'spectator' || self?.spectator) {
    action = h('p', { class: 'muted' }, '관전 중이에요. 다음 판에 자리가 나면 참가합니다.');
  } else if (isHost) {
    const count = o.fillWithBots ? gomoku.GOMOKU_PLAYERS : seated.length;
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
          ? '2명이 필요해요. 봇을 추가하거나 빈자리 채우기를 켜세요'
          : seated.length < gomoku.GOMOKU_PLAYERS
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
        h('div', {}, h('span', { class: 'label' }, '방 코드'), roomCodeView(view.roomCode)),
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
            h('span', { class: 'hint' }, `${seated.length} / ${gomoku.GOMOKU_PLAYERS}`),
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
