import { h, mount } from '../../dom.js';
import type { GameFlow } from '../flow.js';
import { mountReversiGame } from './game.js';
import { ReversiSession } from './session.js';
import { renderReversiWaiting } from './waiting.js';

/** 리버시: 대기 중이면 대기실, 그 밖(시작 카운트다운, 대국, 결과)은 대국 화면 */
export const reversiFlow: GameFlow<ReversiSession> = {
  create: (n) => ReversiSession.create(n),
  join: (c, n) => ReversiSession.join(c, n),
  quickMatch: (n) => ReversiSession.quickMatch(n),
  mount(session, { exit }) {
    let screen: 'waiting' | 'game' | null = null;
    let teardown: (() => void) | null = null;
    const off = session.subscribe((snap) => {
      if (snap.view.phase === 'WAITING') {
        teardown?.();
        teardown = null;
        screen = 'waiting';
        mount(renderReversiWaiting(session, snap, exit));
      } else if (screen !== 'game') {
        teardown?.();
        screen = 'game';
        const root = h('div');
        mount(root);
        teardown = mountReversiGame(root, session, exit);
      }
    });
    return () => {
      off();
      teardown?.();
      teardown = null;
    };
  },
};
