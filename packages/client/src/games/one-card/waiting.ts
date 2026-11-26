import { MAX_PLAYERS, MIN_PLAYERS, TURN_SECONDS_CHOICES, type oneCard } from '@wmg/rules';
import { h } from '../../dom.js';
import { segmented, toggle } from '../../screens/waitingParts.js';
import { renderWaitingShell } from '../../screens/waitingShell.js';
import type { OneCardOptionsView, OneCardSession, OneCardSnapshot } from './session.js';

const PLAYER_CHOICES = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i);

/** "최대 4명 · 턴 30초 · 빈자리 봇" (옵션 요약) */
export function optionsSummary(o: OneCardOptionsView): string {
  return [`최대 ${o.maxPlayers}명`, `턴 ${o.turnSeconds}초`, o.fillWithBots ? '빈자리 봇' : '봇 없음'].join(
    ' · ',
  );
}

/**
 * 원카드 대기실 (one-card.md 7장, 11장, 시안). 오목 대기실과 같은 틀이고 옵션과 고정 규칙 안내만 다르다.
 */
export function renderOneCardWaiting(
  session: OneCardSession,
  snap: OneCardSnapshot,
  onLeave: () => void,
): HTMLElement {
  const { view, me } = snap;
  const o = view.options;
  const isHost = view.hostId === me;
  const setOptions = (options: Partial<oneCard.OneCardRoomOptions>) =>
    session.send('set_options', { options });
  return renderWaitingShell({
    session,
    me,
    role: snap.role,
    roomCode: view.roomCode,
    hostId: view.hostId,
    players: view.players,
    fillWithBots: o.fillWithBots,
    gameId: 'one-card',
    maxSeats: o.maxPlayers,
    optionsId: 'one-card-options',
    summary: optionsSummary(o),
    optionControls: [
      segmented('최대 인원', PLAYER_CHOICES, o.maxPlayers, isHost, (v) => setOptions({ maxPlayers: v })),
      segmented(
        '턴 제한(초) · 넘기면 자동으로 1장 가져와요',
        TURN_SECONDS_CHOICES,
        o.turnSeconds,
        isHost,
        (v) => setOptions({ turnSeconds: v }),
      ),
      toggle('빈자리 봇으로 채우기', o.fillWithBots, isHost, (v) => setOptions({ fillWithBots: v })),
      toggle('비공개 방', o.isPrivate, isHost, (v) => setOptions({ isPrivate: v })),
      // 원카드는 지역마다 규칙이 달라서 이 방의 고정 규칙을 시작 전에 보여 준다 (시안)
      h(
        'div',
        { class: 'fixed-rules', 'data-testid': 'fixed-rules' },
        h('b', {}, '고정 규칙'),
        h('span', {}, '시작 7장 · 20장을 넘으면 파산'),
        h('span', {}, '1장 남으면 원카드 (3초)'),
        h('span', {}, '공격 2(+2) A(+3) 흑백 조커(+5) 컬러 조커(+7)'),
      ),
    ],
    onLeave,
  });
}
