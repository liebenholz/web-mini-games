import { reversi, TURN_SECONDS_CHOICES } from '@wmg/rules';
import { segmented, toggle } from '../../screens/waitingParts.js';
import { renderWaitingShell } from '../../screens/waitingShell.js';
import type { ReversiOptionsView, ReversiSession, ReversiSnapshot } from './session.js';

const BLACK_LABEL: Record<reversi.BlackPolicy, string> = { host: '방장', guest: '상대', random: '무작위' };

/** "흑(선): 무작위 · 턴 30초" (옵션 요약) */
export function optionsSummary(o: ReversiOptionsView): string {
  return `흑(선): ${BLACK_LABEL[o.blackPolicy] ?? '무작위'} · 턴 ${o.turnSeconds}초`;
}

/** 리버시 대기실 (reversi.md 6장). 공통 대기실에 옵션(흑 정하기, 턴 시간)만 넘긴다 */
export function renderReversiWaiting(
  session: ReversiSession,
  snap: ReversiSnapshot,
  onLeave: () => void,
): HTMLElement {
  const { view, me } = snap;
  const o = view.options;
  const isHost = view.hostId === me;
  const setOptions = (options: Partial<reversi.ReversiRoomOptions>) =>
    session.send('set_options', { options });
  return renderWaitingShell({
    session,
    me,
    role: snap.role,
    roomCode: view.roomCode,
    hostId: view.hostId,
    players: view.players,
    fillWithBots: o.fillWithBots,
    gameId: 'reversi',
    maxSeats: reversi.REVERSI_PLAYERS,
    optionsId: 'reversi-options',
    summary: optionsSummary(o),
    optionControls: [
      segmented(
        '흑(선)은 누가',
        reversi.BLACK_POLICIES,
        o.blackPolicy,
        isHost,
        (v) => setOptions({ blackPolicy: v }),
        (v) => BLACK_LABEL[v],
      ),
      segmented('턴 제한(초) · 넘기면 대신 둬요', TURN_SECONDS_CHOICES, o.turnSeconds, isHost, (v) =>
        setOptions({ turnSeconds: v }),
      ),
      toggle('빈자리 봇으로 채우기', o.fillWithBots, isHost, (v) => setOptions({ fillWithBots: v })),
      toggle('비공개 방', o.isPrivate, isHost, (v) => setOptions({ isPrivate: v })),
    ],
    onLeave,
  });
}
