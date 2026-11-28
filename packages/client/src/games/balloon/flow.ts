import { h, mount } from '../../dom.js';
import type { GameFlow } from '../flow.js';
import { mountBalloonGame } from './game.js';
import { BalloonSession } from './session.js';
import { renderBalloonWaiting } from './waiting.js';

/** 풍선 터뜨리기: 대기 중이면 대기실, 그 밖(시작 카운트다운, 대국, 결과)은 대국 화면 */
export const balloonFlow: GameFlow<BalloonSession> = {
  create: (n) => BalloonSession.create(n),
  join: (c, n) => BalloonSession.join(c, n),
  quickMatch: (n) => BalloonSession.quickMatch(n),
  mount(session, { exit }) {
    let screen: 'waiting' | 'game' | null = null;
    let teardown: (() => void) | null = null;
    const off = session.subscribe((snap) => {
      if (snap.view.phase === 'WAITING') {
        teardown?.();
        teardown = null;
        screen = 'waiting';
        mount(renderBalloonWaiting(session, snap, exit));
      } else if (screen !== 'game') {
        teardown?.();
        screen = 'game';
        const root = h('div');
        mount(root);
        teardown = mountBalloonGame(root, session, exit);
      }
    });
    return () => {
      off();
      teardown?.();
      teardown = null;
    };
  },
};
