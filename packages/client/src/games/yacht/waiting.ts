import { MIN_PLAYERS, yacht } from '@wmg/rules';
import { segmented, toggle } from '../../screens/waitingParts.js';
import { renderWaitingShell } from '../../screens/waitingShell.js';
import type { YachtOptionsView, YachtSession, YachtSnapshot } from './session.js';

const PLAYER_CHOICES = Array.from(
  { length: yacht.YACHT_MAX_PLAYERS - MIN_PLAYERS + 1 },
  (_, i) => MIN_PLAYERS + i,
);

/** "최대 2명 · 턴 45초" */
export function optionsSummary(o: YachtOptionsView): string {
  return `최대 ${o.maxPlayers}명 · 턴 ${o.turnSeconds}초`;
}

/** 요트 대기실 (yacht.md 8장). 공통 대기실에 옵션(최대 인원, 턴 시간)만 넘긴다 */
export function renderYachtWaiting(
  session: YachtSession,
  snap: YachtSnapshot,
  onLeave: () => void,
): HTMLElement {
  const { view, me } = snap;
  const o = view.options;
  const isHost = view.hostId === me;
  const setOptions = (options: Partial<yacht.YachtRoomOptions>) => session.send('set_options', { options });
  return renderWaitingShell({
    session,
    me,
    role: snap.role,
    roomCode: view.roomCode,
    hostId: view.hostId,
    players: view.players,
    fillWithBots: o.fillWithBots,
    gameId: 'yacht',
    maxSeats: o.maxPlayers,
    optionsId: 'yacht-options',
    summary: optionsSummary(o),
    optionControls: [
      segmented('최대 인원', PLAYER_CHOICES, o.maxPlayers, isHost, (v) => setOptions({ maxPlayers: v })),
      segmented('턴 제한(초) · 넘기면 대신 기록해요', yacht.YACHT_TURN_SECONDS, o.turnSeconds, isHost, (v) =>
        setOptions({ turnSeconds: v }),
      ),
      toggle('빈자리 봇으로 채우기', o.fillWithBots, isHost, (v) => setOptions({ fillWithBots: v })),
      toggle('비공개 방', o.isPrivate, isHost, (v) => setOptions({ isPrivate: v })),
    ],
    onLeave,
  });
}
