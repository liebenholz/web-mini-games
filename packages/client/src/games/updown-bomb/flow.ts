import { h, mount } from '../../dom.js';
import type { GameFlow } from '../flow.js';
import { mountUpdownGame } from './game.js';
import { UpdownSession } from './session.js';
import { renderUpdownWaiting } from './waiting.js';

/** 업다운 숫자폭탄: 대기 중이면 대기실, 그 밖(시작 카운트다운, 대국, 결과)은 대국 화면 */
export const updownFlow: GameFlow<UpdownSession> = {
  create: (n) => UpdownSession.create(n),
  join: (c, n) => UpdownSession.join(c, n),
  quickMatch: (n) => UpdownSession.quickMatch(n),
  mount(session, { exit }) {
    let screen: 'waiting' | 'game' | null = null;
    let teardown: (() => void) | null = null;
    const off = session.subscribe((snap) => {
      if (snap.view.phase === 'WAITING') {
        teardown?.();
        teardown = null;
        screen = 'waiting';
        mount(renderUpdownWaiting(session, snap, exit));
      } else if (screen !== 'game') {
        teardown?.();
        screen = 'game';
        const root = h('div');
        mount(root);
        teardown = mountUpdownGame(root, session, exit);
      }
    });
    return () => {
      off();
      teardown?.();
      teardown = null;
    };
  },
};
