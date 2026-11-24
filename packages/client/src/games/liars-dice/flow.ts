import { h, mount } from '../../dom.js';
import { Session } from '../../net.js';
import { mountGame } from '../../screens/game.js';
import { renderWaiting } from '../../screens/waiting.js';
import type { GameFlow } from '../flow.js';

/** 거짓말쟁이 주사위: 대기 중이면 대기실, 그 밖에는 게임 화면 (Phaser) */
export const liarsDiceFlow: GameFlow<Session> = {
  create: (n) => Session.create(n, {}),
  join: (c, n) => Session.join(c, n),
  quickMatch: (n) => Session.quickMatch(n),
  mount(session, { exit }) {
    let screen: 'waiting' | 'game' | null = null;
    let teardown: (() => void) | null = null;
    const off = session.subscribe((snap) => {
      if (snap.view.phase === 'WAITING') {
        teardown?.();
        teardown = null;
        screen = 'waiting';
        mount(renderWaiting(session, snap, exit));
      } else if (screen !== 'game') {
        teardown?.();
        screen = 'game';
        const root = h('div');
        mount(root);
        teardown = mountGame(root, session, exit);
      }
    });
    return () => {
      off();
      teardown?.();
      teardown = null;
    };
  },
};
