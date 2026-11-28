/**
 * 게임 목록의 순수 데이터. 화면(registry.ts)과 빌드(vite.config.ts의 링크 미리보기)가 같이 읽는다.
 * DOM이나 다른 모듈을 import하지 않는다 (빌드 설정에서도 불러오기 때문)
 */
export type GameCategory = 'dice' | 'card' | 'board' | 'number' | 'party';

/** 메인 화면 필터 칩의 순서와 이름 (2026-11-28 검색·필터) */
export const CATEGORY_ORDER: readonly GameCategory[] = ['party', 'board', 'card', 'dice', 'number'];
export const CATEGORY_LABEL: Readonly<Record<GameCategory, string>> = {
  party: '파티',
  board: '보드',
  card: '카드',
  dice: '주사위',
  number: '숫자',
};

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
  {
    id: 'balloon',
    name: '풍선 터뜨리기',
    tagline: '바람을 불다 풍선이 터지면 당첨',
    lead: '차례대로 1~3번씩 풍선에 바람을 불어요. 언제 터질지는 아무도 몰라요. 터뜨린 사람이 당첨!',
    players: '2~10명',
    minutes: '1~3분',
    category: 'party',
    status: 'available',
  },
  {
    id: 'treasure',
    name: '보물 찾기',
    tagline: '보물에서 가장 멀리 고르면 당첨',
    lead: '모두 동시에 몰래 한 칸씩 골라요. 보물에서 가장 먼 사람이 당첨! 같은 거리면 다시 골라요.',
    players: '2~10명',
    minutes: '1~2분',
    category: 'party',
    status: 'available',
  },
  {
    id: 'yacht',
    name: '요트 주사위',
    tagline: '주사위 5개로 12칸을 채워 점수를 겨뤄요',
    lead: '한 차례에 3번까지 굴려 12가지 족보 중 빈칸 하나에 기록해요. 합계가 가장 높은 사람이 이겨요.',
    players: '2~4명',
    minutes: '8~12분',
    category: 'dice',
    status: 'available',
  },
  {
    id: 'thief',
    name: '도둑잡기',
    tagline: '조커를 마지막까지 들고 있으면 당첨',
    lead: '다음 사람의 패에서 한 장씩 뽑아 같은 숫자 짝을 내려놓아요. 조커를 끝까지 든 한 명이 당첨!',
    players: '2~6명',
    minutes: '2~4분',
    category: 'party',
    status: 'available',
  },
];
