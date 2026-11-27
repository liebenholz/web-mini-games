/**
 * 게임 목록의 순수 데이터. 화면(registry.ts)과 빌드(vite.config.ts의 링크 미리보기)가 같이 읽는다.
 * DOM이나 다른 모듈을 import하지 않는다 (빌드 설정에서도 불러오기 때문)
 */
export type GameCategory = 'dice' | 'card' | 'board' | 'number' | 'party';

export interface GameCatalogEntry {
  /** 주소에 쓰는 이름: /<id>, /<id>/r/<코드> */
  readonly id: string;
  readonly name: string;
  /** 메인 카드 한 줄 소개, 링크 미리보기 설명 */
  readonly tagline: string;
  /** 게임 로비 소개 문장 */
  readonly lead: string;
  readonly players: string;
  readonly minutes: string;
  readonly category: GameCategory;
  /** 코드가 없는 게임은 coming-soon: 카드만 보이고 누를 수 없다 */
  readonly status: 'available' | 'coming-soon';
}

export const SITE = {
  name: 'WMG',
  fullName: 'Web Multiplayer Ground',
  description: '링크 하나로 친구와 바로 하는 미니게임.',
} as const;

export const CATALOG: readonly GameCatalogEntry[] = [
  {
    id: 'liars-dice',
    name: '거짓말쟁이 주사위',
    tagline: '내 주사위를 단서로 거짓말을 잡아내요',
    lead: '내 주사위만 보고, 판 위에 몇 개가 있는지 부르세요. 거짓말 같으면 "라이어!"',
    players: '2~6명',
    minutes: '5~10분',
    category: 'dice',
    status: 'available',
  },
  {
    id: 'gomoku',
    name: '오목',
    tagline: '다섯 개를 먼저 잇는 사람이 이겨요',
    lead: '가로, 세로, 대각선으로 다섯 개를 먼저 이어요.',
    players: '2명',
    minutes: '5분',
    category: 'board',
    status: 'available',
  },
  {
    id: 'one-card',
    name: '원카드',
    tagline: '패를 먼저 다 내는 사람이 이겨요',
    lead: '같은 모양이나 숫자를 내고, 특수 카드로 상대를 막아요.',
    players: '2~6명',
    minutes: '10분',
    category: 'card',
    status: 'available',
  },
  {
    id: 'bulls-and-cows',
    name: '숫자야구',
    tagline: '스트라이크와 볼로 상대 숫자를 맞혀요',
    lead: '상대의 비밀 숫자를 스트라이크와 볼로 추리해요.',
    players: '2명',
    minutes: '5분',
    category: 'number',
    status: 'available',
  },
  {
    id: 'reversi',
    name: '리버시',
    tagline: '끼워서 뒤집고, 돌이 많은 쪽이 이겨요',
    lead: '상대 돌을 내 돌 사이에 끼우면 내 색으로 뒤집혀요. 끝났을 때 돌이 많으면 이겨요.',
    players: '2명',
    minutes: '10분',
    category: 'board',
    status: 'available',
  },
  {
    id: 'updown-bomb',
    name: '업다운 숫자폭탄',
    tagline: '범위를 좁히다 폭탄 숫자를 말하면 당첨',
    lead: '숨은 폭탄 숫자를 피해 차례대로 숫자를 말해요. 폭탄을 말한 사람이 당첨!',
    players: '2~6명',
    minutes: '1~3분',
    category: 'party',
    status: 'available',
  },
];
