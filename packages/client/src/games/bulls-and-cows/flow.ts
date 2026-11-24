import { h, mount } from '../../dom.js';
import type { GameFlow } from '../flow.js';
import { mountBullsGame } from './game.js';
import { BullsSession } from './session.js';
import { renderBullsWaiting } from './waiting.js';

/** 숫자야구: 대기 중이면 대기실, 그 밖(시작, 비밀 숫자, 추측, 결과)은 게임 화면 */
export const bullsFlow: GameFlow<BullsSession> = {
  create: (n) => BullsSession.create(n),
  join: (c, n) => BullsSession.join(c, n),
  quickMatch: (n) => BullsSession.quickMatch(n),
  mount(session, { exit }) {
    let screen: 'waiting' | 'game' | null = null;
    let teardown: (() => void) | null = null;
    const off = session.subscribe((snap) => {
      if (snap.view.phase === 'WAITING') {
        teardown?.();
        teardown = null;
        screen = 'waiting';
        mount(renderBullsWaiting(session, snap, exit));
      } else if (screen !== 'game') {
        teardown?.();
        screen = 'game';
        const root = h('div');
        mount(root);
        teardown = mountBullsGame(root, session, exit);
      }
    });
    return () => {
      off();
      teardown?.();
      teardown = null;
    };
  },
};
