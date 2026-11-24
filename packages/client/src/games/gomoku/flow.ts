import { h, mount } from '../../dom.js';
import type { GameFlow } from '../flow.js';
import { mountGomokuGame } from './game.js';
import { GomokuSession } from './session.js';
import { renderGomokuWaiting } from './waiting.js';

/** 오목: 대기 중이면 대기실, 그 밖(시작 카운트다운, 대국, 결과)은 대국 화면 */
export const gomokuFlow: GameFlow<GomokuSession> = {
  create: (n) => GomokuSession.create(n),
  join: (c, n) => GomokuSession.join(c, n),
  quickMatch: (n) => GomokuSession.quickMatch(n),
  mount(session, { exit }) {
    let screen: 'waiting' | 'game' | null = null;
    let teardown: (() => void) | null = null;
    const off = session.subscribe((snap) => {
      if (snap.view.phase === 'WAITING') {
        teardown?.();
        teardown = null;
        screen = 'waiting';
        mount(renderGomokuWaiting(session, snap, exit));
      } else if (screen !== 'game') {
        teardown?.();
        screen = 'game';
        const root = h('div');
        mount(root);
        teardown = mountGomokuGame(root, session, exit);
      }
    });
    return () => {
      off();
      teardown?.();
      teardown = null;
    };
  },
};
