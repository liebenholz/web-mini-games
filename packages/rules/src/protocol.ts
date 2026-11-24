/**
 * 명세 6장 메시지 프로토콜의 타입 계약. 서버와 클라이언트가 같은 정의를 쓴다.
 * 런타임 코드는 상수뿐이며 I/O는 없다.
 */
import type { Bid, BidFace, DieFace } from './types.js';
import type { RoomOptions } from './room.js';

export const GAME_ID = 'liars_dice';

export const PHASES = [
  'WAITING',
  'STARTING',
  'ROLLING',
  'BIDDING',
  'REVEAL',
  'RESOLVE',
  'GAME_OVER',
] as const;
export type GamePhase = (typeof PHASES)[number];

/** 명세 9장 에러 코드 + 로비 조작용 코드 */
export const ERROR_CODES = [
  'INVALID_BID',
  'NOT_YOUR_TURN',
  'NO_BID_TO_CALL',
  'STALE_TURN',
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'DUPLICATE_SESSION',
  'RATE_LIMITED',
  // 아래는 명세 6장 거부 조건을 코드로 옮긴 것 (start_game, 옵션 변경 등)
  'NOT_HOST',
  'NOT_ENOUGH_PLAYERS',
  'NOT_ALL_READY',
  'INVALID_STATE',
  'INVALID_OPTIONS',
  'INVALID_NICKNAME',
  'INVALID_MESSAGE',
  'SERVER_DRAINING',
  // 방장이 대기실에서 내보냈다. 같은 방에 다시 들어올 수 없다
  'KICKED',
  // 오목 착수 거부 (gomoku.md GE-02~GE-04)
  'INVALID_MOVE',
  'OCCUPIED',
  'FORBIDDEN_MOVE',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** WebSocket 종료 코드 (4000~4999는 애플리케이션 정의 영역) */
export const CLOSE_CODES = {
  DUPLICATE_SESSION: 4001,
  RATE_LIMITED: 4002,
  KICKED: 4003,
} as const;

/** 입장 옵션 (join / create) */
export interface JoinOptions {
  readonly nickname: string;
  /** 브라우저에 저장한 게스트 ID. 로그인 방식은 미결정 (명세 12장) */
  readonly guestId: string;
  /** 방을 만들 때만 의미가 있다 */
  readonly options?: Partial<RoomOptions>;
}

// ---------- 클라이언트 → 서버 ----------

export interface ClientMessages {
  set_ready: { readonly ready: boolean };
  start_game: Record<string, never>;
  bid: { readonly quantity: number; readonly face: BidFace; readonly turnId: string };
  call_liar: { readonly turnId: string };
  leave_room: Record<string, never>;
  rematch: Record<string, never>;
  /** 방장만 (명세 8장 대기실) */
  set_options: { readonly options: Partial<RoomOptions> };
  /** 방장만 (명세 8장 대기실 "봇 추가") */
  add_bot: Record<string, never>;
  remove_bot: { readonly playerId: string };
  /** 방장만, 대기실에서. 사람 참가자를 내보낸다 (이 방에는 다시 못 들어온다) */
  kick_player: { readonly playerId: string };
}
export type ClientMessageType = keyof ClientMessages;

// ---------- 서버 → 클라이언트 ----------

/** 모든 서버 메시지에 붙는 순서 정보 (명세 6장) */
export interface Envelope {
  readonly roomId: string;
  readonly roundNo: number;
  readonly seq: number;
}

export interface RevealedDice {
  readonly playerId: string;
  readonly seat: number;
  readonly dice: readonly DieFace[];
}

export interface RankingEntry {
  readonly playerId: string;
  readonly nickname: string;
  readonly seat: number;
  readonly rank: number;
  readonly isBot: boolean;
}

export interface ServerMessages {
  /** 입장 직후 본인에게. 공개 playerId와 역할 (게스트 ID는 다시 보내지 않는다) */
  welcome: { readonly playerId: string; readonly role: 'player' | 'spectator' };
  your_dice: { readonly dice: readonly DieFace[] };
  turn_start: {
    readonly playerId: string;
    readonly turnId: string;
    readonly deadline: number;
    readonly serverNow: number;
  };
  bid_made: {
    readonly playerId: string;
    readonly quantity: number;
    readonly face: BidFace;
    readonly isAuto: boolean;
  };
  liar_called: { readonly caller: string; readonly target: string };
  reveal: {
    readonly dice: readonly RevealedDice[];
    readonly bid: Bid;
    readonly actual: number;
    readonly bidSucceeded: boolean;
    readonly loserId: string;
  };
  dice_lost: { readonly playerId: string; readonly diceCount: number };
  player_eliminated: { readonly playerId: string; readonly rank: number };
  game_over: { readonly ranking: readonly RankingEntry[] };
  error: { readonly code: ErrorCode; readonly message: string };
}
export type ServerMessageType = keyof ServerMessages;
export type ServerMessage<T extends ServerMessageType> = Envelope & ServerMessages[T];
