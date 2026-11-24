import { h, mount } from '../../dom.js';
import type { GameFlow } from '../flow.js';
import { mountOneCardGame } from './game.js';
import { OneCardSession } from './session.js';
import { renderOneCardWaiting } from './waiting.js';

/** 원카드: 대기 중이면 대기실, 그 밖(시작 카운트다운, 게임, 결과)은 게임 화면 */
export const oneCardFlow: GameFlow<OneCardSession> = {
  create: (n) => OneCardSession.create(n),
  join: (c, n) => OneCardSession.join(c, n),
  quickMatch: (n) => OneCardSession.quickMatch(n),
  mount(session, { exit }) {
    let screen: 'waiting' | 'game' | null = null;
    let teardown: (() => void) | null = null;
    const off = session.subscribe((snap) => {
      if (snap.view.phase === 'WAITING') {
        teardown?.();
        teardown = null;
        screen = 'waiting';
        mount(renderOneCardWaiting(session, snap, exit));
      } else if (screen !== 'game') {
        teardown?.();
        screen = 'game';
        const root = h('div');
        mount(root);
        teardown = mountOneCardGame(root, session, exit);
      }
    });
    return () => {
      off();
      teardown?.();
      teardown = null;
    };
  },
};
