import { MIN_PLAYERS, thief } from '@wmg/rules';
import { segmented, toggle } from '../../screens/waitingParts.js';
import { renderWaitingShell } from '../../screens/waitingShell.js';
import type { ThiefOptionsView, ThiefSession, ThiefSnapshot } from './session.js';

const PLAYER_CHOICES = Array.from(
  { length: thief.THIEF_MAX_PLAYERS - MIN_PLAYERS + 1 },
  (_, i) => MIN_PLAYERS + i,
);

/** "최대 4명 · 턴 15초" */
export function optionsSummary(o: ThiefOptionsView): string {
  return `최대 ${o.maxPlayers}명 · 턴 ${o.turnSeconds}초`;
}

/** 도둑잡기 대기실 (thief.md 3장). 공통 대기실에 옵션(최대 인원, 턴 시간)만 넘긴다 */
export function renderThiefWaiting(
  session: ThiefSession,
  snap: ThiefSnapshot,
  onLeave: () => void,
): HTMLElement {
  const { view, me } = snap;
  const o = view.options;
  const isHost = view.hostId === me;
  const setOptions = (options: Partial<thief.ThiefRoomOptions>) => session.send('set_options', { options });
  return renderWaitingShell({
    session,
    me,
    role: snap.role,
    roomCode: view.roomCode,
    hostId: view.hostId,
    players: view.players,
    fillWithBots: o.fillWithBots,
    gameId: 'thief',
    maxSeats: o.maxPlayers,
    optionsId: 'thief-options',
    summary: optionsSummary(o),
    optionControls: [
      segmented('최대 인원', PLAYER_CHOICES, o.maxPlayers, isHost, (v) => setOptions({ maxPlayers: v })),
      segmented('턴 제한(초) · 넘기면 대신 뽑아요', thief.THIEF_TURN_SECONDS, o.turnSeconds, isHost, (v) =>
        setOptions({ turnSeconds: v }),
      ),
      toggle('빈자리 봇으로 채우기', o.fillWithBots, isHost, (v) => setOptions({ fillWithBots: v })),
      toggle('비공개 방', o.isPrivate, isHost, (v) => setOptions({ isPrivate: v })),
    ],
    onLeave,
  });
}
