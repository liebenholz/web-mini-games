import { MAX_PLAYERS, MIN_PLAYERS, updown } from '@wmg/rules';
import { segmented, toggle } from '../../screens/waitingParts.js';
import { renderWaitingShell } from '../../screens/waitingShell.js';
import type { UpdownOptionsView, UpdownSession, UpdownSnapshot } from './session.js';

const PLAYER_CHOICES = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i);

/** "범위 1~100 · 최대 6명 · 턴 15초" */
export function optionsSummary(o: UpdownOptionsView): string {
  return `범위 1~${o.rangeMax} · 최대 ${o.maxPlayers}명 · 턴 ${o.turnSeconds}초`;
}

/** 업다운 대기실 (updown-bomb.md 8장). 공통 대기실에 옵션(범위, 최대 인원, 턴 시간)만 넘긴다 */
export function renderUpdownWaiting(
  session: UpdownSession,
  snap: UpdownSnapshot,
  onLeave: () => void,
): HTMLElement {
  const { view, me } = snap;
  const o = view.options;
  const isHost = view.hostId === me;
  const setOptions = (options: Partial<updown.UpdownRoomOptions>) => session.send('set_options', { options });
  return renderWaitingShell({
    session,
    me,
    role: snap.role,
    roomCode: view.roomCode,
    hostId: view.hostId,
    players: view.players,
    fillWithBots: o.fillWithBots,
    gameId: 'updown-bomb',
    maxSeats: o.maxPlayers,
    optionsId: 'updown-options',
    summary: optionsSummary(o),
    optionControls: [
      segmented(
        '숫자 범위',
        updown.UPDOWN_RANGES,
        o.rangeMax,
        isHost,
        (v) => setOptions({ rangeMax: v }),
        (v) => `1~${v}`,
      ),
      segmented('최대 인원', PLAYER_CHOICES, o.maxPlayers, isHost, (v) => setOptions({ maxPlayers: v })),
      segmented('턴 제한(초) · 넘기면 대신 말해요', updown.UPDOWN_TURN_SECONDS, o.turnSeconds, isHost, (v) =>
        setOptions({ turnSeconds: v }),
      ),
      toggle('빈자리 봇으로 채우기', o.fillWithBots, isHost, (v) => setOptions({ fillWithBots: v })),
      toggle('비공개 방', o.isPrivate, isHost, (v) => setOptions({ isPrivate: v })),
    ],
    onLeave,
  });
}
