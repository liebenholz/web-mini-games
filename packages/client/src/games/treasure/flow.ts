import { h, mount } from '../../dom.js';
import type { GameFlow } from '../flow.js';
import { mountTreasureGame } from './game.js';
import { TreasureSession } from './session.js';
import { renderTreasureWaiting } from './waiting.js';

/** 보물 찾기: 대기 중이면 대기실, 그 밖(시작 카운트다운, 대국, 결과)은 대국 화면 */
export const treasureFlow: GameFlow<TreasureSession> = {
  create: (n) => TreasureSession.create(n),
  join: (c, n) => TreasureSession.join(c, n),
  quickMatch: (n) => TreasureSession.quickMatch(n),
  mount(session, { exit }) {
    let screen: 'waiting' | 'game' | null = null;
    let teardown: (() => void) | null = null;
    const off = session.subscribe((snap) => {
      if (snap.view.phase === 'WAITING') {
        teardown?.();
        teardown = null;
        screen = 'waiting';
        mount(renderTreasureWaiting(session, snap, exit));
      } else if (screen !== 'game') {
        teardown?.();
        screen = 'game';
        const root = h('div');
        mount(root);
        teardown = mountTreasureGame(root, session, exit);
      }
    });
    return () => {
      off();
      teardown?.();
      teardown = null;
    };
  },
};
