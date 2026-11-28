import {
  balloon,
  bulls,
  treasure,
  thief,
  yacht,
  GAME_ID,
  gomoku,
  oneCard,
  reversi,
  updown,
} from '@wmg/rules';
import { bullsRules } from './bulls-and-cows/rules.js';
import { CATALOG, type GameCatalogEntry } from './catalog.js';
import { asFlow, type GameFlow } from './flow.js';
import { gomokuRules } from './gomoku/rules.js';
import { liarsDiceRules } from './liars-dice/rules.js';
import { oneCardRules } from './one-card/rules.js';
import { reversiRules } from './reversi/rules.js';
import { updownRules } from './updown-bomb/rules.js';
import { balloonRules } from './balloon/rules.js';
import { treasureRules } from './treasure/rules.js';
import { thiefRules } from './thief/rules.js';
import { yachtRules } from './yacht/rules.js';

export type { GameCategory } from './catalog.js';
export { LEGACY_GAME_ID } from '../identity.js';

/** 게임 목록 (ADR 0002): 메인 카드, 로비 머리말, 규칙 시트가 모두 이 값을 읽는다 */
export interface GameInfo extends GameCatalogEntry {
  /** 서버 방 종류. 준비 중인 게임은 없다 */
  readonly roomType: string | null;
  readonly rules: (() => HTMLElement) | null;
  /**
   * 연결과 화면을 불러온다 (ADR 0003: 게임 코드는 그 게임에 들어갈 때 받는다). 준비 중인 게임은 없다.
   * 메인 번들은 게임 수와 상관없이 일정하다
   */
  readonly loadFlow: (() => Promise<GameFlow>) | null;
}

/** 구현된 게임의 서버 방 종류와 규칙 내용. 게임을 추가하면 여기에 한 줄 넣고 catalog의 상태를 바꾼다 */
const IMPLEMENTED: Record<string, Pick<GameInfo, 'roomType' | 'rules' | 'loadFlow'>> = {
  'liars-dice': {
    roomType: GAME_ID,
    rules: liarsDiceRules,
    loadFlow: () => import('./liars-dice/flow.js').then((m) => asFlow(m.liarsDiceFlow)),
  },
  gomoku: {
    roomType: gomoku.GOMOKU_ROOM_TYPE,
    rules: gomokuRules,
    loadFlow: () => import('./gomoku/flow.js').then((m) => asFlow(m.gomokuFlow)),
  },
  'one-card': {
    roomType: oneCard.ONE_CARD_ROOM_TYPE,
    rules: oneCardRules,
    loadFlow: () => import('./one-card/flow.js').then((m) => asFlow(m.oneCardFlow)),
  },
  'bulls-and-cows': {
    roomType: bulls.BULLS_ROOM_TYPE,
    rules: bullsRules,
    loadFlow: () => import('./bulls-and-cows/flow.js').then((m) => asFlow(m.bullsFlow)),
  },
  reversi: {
    roomType: reversi.REVERSI_ROOM_TYPE,
    rules: reversiRules,
    loadFlow: () => import('./reversi/flow.js').then((m) => asFlow(m.reversiFlow)),
  },
  'updown-bomb': {
    roomType: updown.UPDOWN_ROOM_TYPE,
    rules: updownRules,
    loadFlow: () => import('./updown-bomb/flow.js').then((m) => asFlow(m.updownFlow)),
  },
  balloon: {
    roomType: balloon.BALLOON_ROOM_TYPE,
    rules: balloonRules,
    loadFlow: () => import('./balloon/flow.js').then((m) => asFlow(m.balloonFlow)),
  },
  treasure: {
    roomType: treasure.TREASURE_ROOM_TYPE,
    rules: treasureRules,
    loadFlow: () => import('./treasure/flow.js').then((m) => asFlow(m.treasureFlow)),
  },
  thief: {
    roomType: thief.THIEF_ROOM_TYPE,
    rules: thiefRules,
    loadFlow: () => import('./thief/flow.js').then((m) => asFlow(m.thiefFlow)),
  },
  yacht: {
    roomType: yacht.YACHT_ROOM_TYPE,
    rules: yachtRules,
    loadFlow: () => import('./yacht/flow.js').then((m) => asFlow(m.yachtFlow)),
  },
};

export const GAMES: readonly GameInfo[] = CATALOG.map((entry) => {
  const impl = IMPLEMENTED[entry.id];
  // 코드가 없는 게임은 catalog에 "플레이 가능"으로 적혀 있어도 준비 중으로 보인다
  return impl
    ? { ...entry, ...impl }
    : { ...entry, status: 'coming-soon', roomType: null, rules: null, loadFlow: null };
});

export function findGame(id: string): GameInfo | undefined {
  return GAMES.find((g) => g.id === id);
}

export function gameByRoomType(roomType: string): GameInfo | undefined {
  return GAMES.find((g) => g.roomType === roomType);
}
