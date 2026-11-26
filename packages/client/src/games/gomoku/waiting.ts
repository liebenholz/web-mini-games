import { gomoku, TURN_SECONDS_CHOICES } from '@wmg/rules';
import { h } from '../../dom.js';
import { segmented, toggle } from '../../screens/waitingParts.js';
import { renderWaitingShell } from '../../screens/waitingShell.js';
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
  const setOptions = (options: Partial<gomoku.GomokuRoomOptions>) => session.send('set_options', { options });
  return renderWaitingShell({
    session,
    me,
    role: snap.role,
    roomCode: view.roomCode,
    hostId: view.hostId,
    players: view.players,
    fillWithBots: o.fillWithBots,
    gameId: 'gomoku',
    maxSeats: gomoku.GOMOKU_PLAYERS,
    optionsId: 'gomoku-options',
    summary: optionsSummary(o),
    optionControls: [
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
    ],
    onLeave,
  });
}
