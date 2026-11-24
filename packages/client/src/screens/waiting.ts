import { GAME_ID, MAX_PLAYERS, MIN_PLAYERS, TURN_SECONDS_CHOICES, type RoomOptions } from '@wmg/rules';
import { h, svg, toast } from '../dom.js';
import { icons } from '../icons.js';
import type { PlayerView, Session, SessionSnapshot } from '../net.js';
import { gameByRoomType } from '../games/registry.js';
import { invitePath } from '../routes.js';
import { avatar } from './avatar.js';

function inviteUrl(code: string): string {
  const game = gameByRoomType(GAME_ID);
  return `${location.origin}${game ? invitePath(game, code) : `/r/${code}`}`;
}

async function copy(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast(text);
  }
}

function segmented<T extends number>(
  label: string,
  values: readonly T[],
  current: T,
  editable: boolean,
  onPick: (v: T) => void,
) {
  const group = h('div', { class: 'segmented', role: 'group', 'aria-label': label });
  for (const v of values) {
    const b = h(
      'button',
      { type: 'button', 'aria-pressed': String(v === current), disabled: !editable },
      String(v),
    );
    b.addEventListener('click', () => onPick(v));
    group.append(b);
  }
  return h('div', { class: 'option' }, h('span', { class: 'label' }, label), group);
}

function toggle(label: string, value: boolean, editable: boolean, onChange: (v: boolean) => void) {
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

function seatItem(
  p: PlayerView,
  index: number,
  me: string,
  canRemove: boolean,
  onRemove: () => void,
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
        { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': `${p.nickname} 빼기` },
        svg(icons.close),
      )
    : null;
  remove?.addEventListener('click', onRemove);
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
  );
}

/** 대기실 (명세 8장): 좌석, 준비, 옵션(방장만), 코드·링크 복사, 봇 추가, 시작 */
export function renderWaiting(session: Session, snap: SessionSnapshot, onLeave: () => void): HTMLElement {
  const { view, me } = snap;
  const isHost = view.hostId === me;
  const self = view.players.find((p) => p.id === me);
  const seated = view.players.filter((p) => !p.spectator).sort((a, b) => a.seat - b.seat);
  const humansNotReady = seated.filter((p) => !p.isBot && !p.isHost && !p.ready);
  const setOptions = (options: Partial<RoomOptions>) => session.send('set_options', { options });

  const seats = h('ul', { class: 'seats', 'aria-label': '좌석' });
  seated.forEach((p, i) => {
    seats.append(seatItem(p, i, me, isHost && p.isBot, () => session.send('remove_bot', { playerId: p.id })));
  });
  for (let i = seated.length; i < view.options.maxPlayers; i += 1) {
    if (isHost && i === seated.length) {
      const add = h('button', { class: 'btn btn-soft', type: 'button' }, svg(icons.plus), '봇 추가');
      add.addEventListener('click', () => session.send('add_bot', {}));
      seats.append(h('li', { class: 'seat empty' }, add));
    } else {
      seats.append(
        h('li', { class: 'seat empty' }, view.options.fillWithBots ? '빈자리 · 시작하면 봇' : '빈자리'),
      );
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
  copyLink.addEventListener('click', () => void copy(inviteUrl(view.roomCode), '초대 링크를 복사했습니다.'));

  const back = h('button', { class: 'btn btn-ghost', type: 'button' }, svg(icons.back), '나가기');
  back.addEventListener('click', onLeave);

  const o = view.options;
  const options = h(
    'section',
    { class: 'card options', 'aria-labelledby': 'options-title' },
    h(
      'div',
      { class: 'section-head' },
      h('h2', { id: 'options-title' }, '방 옵션'),
      !isHost ? h('span', { class: 'hint' }, '방장만 바꿀 수 있어요') : null,
    ),
    segmented('최대 인원', range(MIN_PLAYERS, MAX_PLAYERS), o.maxPlayers, isHost, (v) =>
      setOptions({ maxPlayers: v }),
    ),
    segmented('턴 제한(초)', TURN_SECONDS_CHOICES, o.turnSeconds, isHost, (v) =>
      setOptions({ turnSeconds: v }),
    ),
    segmented('시작 주사위', range(3, 5), o.startingDice, isHost, (v) => setOptions({ startingDice: v })),
    toggle('빈자리 봇으로 채우기', o.fillWithBots, isHost, (v) => setOptions({ fillWithBots: v })),
    toggle('비공개 방', o.isPrivate, isHost, (v) => setOptions({ isPrivate: v })),
  );

  let action: HTMLElement;
  if (snap.role === 'spectator' || self?.spectator) {
    action = h('p', { class: 'muted' }, '관전 중이에요. 다음 판에 자리가 나면 참가합니다.');
  } else if (isHost) {
    const count = o.fillWithBots ? o.maxPlayers : seated.length;
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
          ? '최소 2명이 필요해요. 봇을 추가하거나 빈자리 채우기를 켜세요'
          : o.fillWithBots && seated.length < o.maxPlayers
            ? `빈자리 ${o.maxPlayers - seated.length}개는 봇이 채워요`
            : null;
    action = h('div', { class: 'dock-inner' }, note ? h('p', { class: 'hint' }, note) : null, start);
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
        h(
          'div',
          {},
          h('span', { class: 'label' }, '방 코드'),
          h('span', { class: 'code', 'data-testid': 'room-code' }, view.roomCode),
        ),
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
            h('span', { class: 'hint' }, `${seated.length} / ${o.maxPlayers}`),
          ),
          seats,
        ),
        options,
      ),
    ),
    h('div', { class: 'dock' }, action),
  );
}

function range(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}
