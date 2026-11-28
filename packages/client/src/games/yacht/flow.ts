import { h, mount } from '../../dom.js';
import type { GameFlow } from '../flow.js';
import { mountYachtGame } from './game.js';
import { YachtSession } from './session.js';
import { renderYachtWaiting } from './waiting.js';

/** 요트 주사위: 대기 중이면 대기실, 그 밖(시작 카운트다운, 대국, 결과)은 대국 화면 */
export const yachtFlow: GameFlow<YachtSession> = {
  create: (n) => YachtSession.create(n),
  join: (c, n) => YachtSession.join(c, n),
  quickMatch: (n) => YachtSession.quickMatch(n),
  mount(session, { exit }) {
    let screen: 'waiting' | 'game' | null = null;
    let teardown: (() => void) | null = null;
    const off = session.subscribe((snap) => {
      if (snap.view.phase === 'WAITING') {
        teardown?.();
        teardown = null;
        screen = 'waiting';
        mount(renderYachtWaiting(session, snap, exit));
      } else if (screen !== 'game') {
        teardown?.();
        screen = 'game';
        const root = h('div');
        mount(root);
        teardown = mountYachtGame(root, session, exit);
      }
    });
    return () => {
      off();
      teardown?.();
      teardown = null;
    };
  },
};
