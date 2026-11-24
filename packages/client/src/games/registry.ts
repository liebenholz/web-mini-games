import { GAME_ID } from '@wmg/rules';
import { CATALOG, type GameCatalogEntry } from './catalog.js';
import { liarsDiceRules } from './liars-dice/rules.js';

export type { GameCategory } from './catalog.js';
export { LEGACY_GAME_ID } from '../identity.js';

/** 게임 목록 (ADR 0002): 메인 카드, 로비 머리말, 규칙 시트가 모두 이 값을 읽는다 */
export interface GameInfo extends GameCatalogEntry {
  /** 서버 방 종류. 준비 중인 게임은 없다 */
  readonly roomType: string | null;
  readonly rules: (() => HTMLElement) | null;
}

/** 구현된 게임의 서버 방 종류와 규칙 내용. 게임을 추가하면 여기에 한 줄 넣고 catalog의 상태를 바꾼다 */
const IMPLEMENTED: Record<string, Pick<GameInfo, 'roomType' | 'rules'>> = {
  'liars-dice': { roomType: GAME_ID, rules: liarsDiceRules },
};

export const GAMES: readonly GameInfo[] = CATALOG.map((entry) => {
  const impl = IMPLEMENTED[entry.id];
  // 코드가 없는 게임은 catalog에 "플레이 가능"으로 적혀 있어도 준비 중으로 보인다
  return impl ? { ...entry, ...impl } : { ...entry, status: 'coming-soon', roomType: null, rules: null };
});

export function findGame(id: string): GameInfo | undefined {
  return GAMES.find((g) => g.id === id);
}

export function gameByRoomType(roomType: string): GameInfo | undefined {
  return GAMES.find((g) => g.roomType === roomType);
}
