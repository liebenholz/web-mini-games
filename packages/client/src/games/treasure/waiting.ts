import { MIN_PLAYERS, treasure } from '@wmg/rules';
import { segmented, toggle } from '../../screens/waitingParts.js';
import { renderWaitingShell } from '../../screens/waitingShell.js';
import type { TreasureOptionsView, TreasureSession, TreasureSnapshot } from './session.js';

const PLAYER_CHOICES = Array.from(
  { length: treasure.TREASURE_MAX_PLAYERS - MIN_PLAYERS + 1 },
  (_, i) => MIN_PLAYERS + i,
);

/** "최대 6명 · 선택 15초" */
export function optionsSummary(o: TreasureOptionsView): string {
  return `최대 ${o.maxPlayers}명 · 선택 ${o.pickSeconds}초`;
}

/** 보물 찾기 대기실 (treasure.md 8장). 공통 대기실에 옵션(최대 인원, 선택 시간)만 넘긴다 */
export function renderTreasureWaiting(
  session: TreasureSession,
  snap: TreasureSnapshot,
  onLeave: () => void,
): HTMLElement {
  const { view, me } = snap;
  const o = view.options;
  const isHost = view.hostId === me;
  const setOptions = (options: Partial<treasure.TreasureRoomOptions>) =>
    session.send('set_options', { options });
  return renderWaitingShell({
    session,
    me,
    role: snap.role,
    roomCode: view.roomCode,
    hostId: view.hostId,
    players: view.players,
    fillWithBots: o.fillWithBots,
    gameId: 'treasure',
    maxSeats: o.maxPlayers,
    optionsId: 'treasure-options',
    summary: optionsSummary(o),
    optionControls: [
      segmented('최대 인원', PLAYER_CHOICES, o.maxPlayers, isHost, (v) => setOptions({ maxPlayers: v })),
      segmented(
        '선택 시간(초) · 넘기면 대신 골라요',
        treasure.TREASURE_PICK_SECONDS,
        o.pickSeconds,
        isHost,
        (v) => setOptions({ pickSeconds: v }),
      ),
      toggle('빈자리 봇으로 채우기', o.fillWithBots, isHost, (v) => setOptions({ fillWithBots: v })),
      toggle('비공개 방', o.isPrivate, isHost, (v) => setOptions({ isPrivate: v })),
    ],
    onLeave,
  });
}
