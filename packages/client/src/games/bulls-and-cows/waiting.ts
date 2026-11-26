import { bulls } from '@wmg/rules';
import { h } from '../../dom.js';
import { segmented, toggle } from '../../screens/waitingParts.js';
import { renderWaitingShell } from '../../screens/waitingShell.js';
import type { BullsOptionsView, BullsSession, BullsSnapshot } from './session.js';

const attemptsLabel = (n: bulls.MaxAttempts) => (n === 0 ? '제한 없음' : String(n));

/** "3자리 · 시도 10번 · 턴 60초" (옵션 요약) */
export function optionsSummary(o: BullsOptionsView): string {
  return [
    `${o.digits}자리`,
    o.maxAttempts === 0 ? '시도 제한 없음' : `시도 ${o.maxAttempts}번`,
    `턴 ${o.turnSeconds}초`,
  ].join(' · ');
}

/**
 * 숫자야구 대기실 (bulls-and-cows.md 4장, 8장, 시안 2). 다른 게임 대기실과 같은 틀이고 옵션과 규칙 안내만 다르다.
 */
export function renderBullsWaiting(
  session: BullsSession,
  snap: BullsSnapshot,
  onLeave: () => void,
): HTMLElement {
  const { view, me } = snap;
  const o = view.options;
  const isHost = view.hostId === me;
  const setOptions = (options: Partial<bulls.BullsRoomOptions>) => session.send('set_options', { options });
  return renderWaitingShell({
    session,
    me,
    role: snap.role,
    roomCode: view.roomCode,
    hostId: view.hostId,
    players: view.players,
    fillWithBots: o.fillWithBots,
    gameId: 'bulls-and-cows',
    maxSeats: bulls.BULLS_PLAYERS,
    optionsId: 'bulls-options',
    summary: optionsSummary(o),
    optionControls: [
      segmented(
        '자릿수',
        bulls.DIGIT_CHOICES,
        o.digits,
        isHost,
        (v) => setOptions({ digits: v }),
        (v) => `${v}자리`,
      ),
      segmented(
        '시도 제한',
        bulls.MAX_ATTEMPT_CHOICES,
        o.maxAttempts,
        isHost,
        (v) => setOptions({ maxAttempts: v }),
        attemptsLabel,
      ),
      segmented(
        '턴 제한(초) · 넘기면 그 턴을 넘겨요',
        bulls.BULLS_TURN_SECONDS_CHOICES,
        o.turnSeconds,
        isHost,
        (v) => setOptions({ turnSeconds: v }),
      ),
      toggle('빈자리 봇으로 채우기', o.fillWithBots, isHost, (v) => setOptions({ fillWithBots: v })),
      toggle('비공개 방', o.isPrivate, isHost, (v) => setOptions({ isPrivate: v })),
      h(
        'div',
        { class: 'fixed-rules', 'data-testid': 'fixed-rules' },
        h('b', {}, '규칙'),
        h('span', {}, '0~9, 숫자 중복 없음 · 맨 앞 0 가능'),
        h('span', {}, '비밀 숫자는 60초 안에 (못 정하면 무작위)'),
        h('span', {}, '선공이 맞히면 후공에게 마지막 기회'),
        h('span', {}, '3자리 1S 2B · OUT / 4자리 1B 2C · 0B 0C'),
      ),
    ],
    onLeave,
  });
}
