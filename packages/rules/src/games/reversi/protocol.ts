/**
 * 리버시 방 옵션과 메시지 타입 (docs/specs/reversi.md 3장, 4장).
 * 공통 대기실 메시지(set_ready, start_game, set_options, add_bot, remove_bot, kick_player, rematch, leave_room)는
 * 다른 게임과 같은 이름과 형태를 쓴다.
 */
import { TURN_SECONDS_CHOICES, type TurnSeconds } from '../../room.js';
import { BLACK_POLICIES, type BlackPolicy } from '../gomoku/protocol.js';
import type { ReversiColor } from './board.js';

export { BLACK_POLICIES, type BlackPolicy };

/** 서버 방 종류이자 주소 이름 (ADR 0002) */
export const REVERSI_ROOM_TYPE = 'reversi';
export const REVERSI_PLAYERS = 2;

export interface ReversiRoomOptions {
  readonly blackPolicy: BlackPolicy;
  readonly turnSeconds: TurnSeconds;
  readonly fillWithBots: boolean;
  readonly isPrivate: boolean;
}

export const DEFAULT_REVERSI_OPTIONS: ReversiRoomOptions = Object.freeze({
  blackPolicy: 'random',
  turnSeconds: 30,
  fillWithBots: true,
  isPrivate: true,
});

export type ReversiOptionsResult =
  | { readonly ok: true; readonly options: ReversiRoomOptions }
  | {
      readonly ok: false;
      readonly code: 'INVALID_OPTIONS';
      readonly field: keyof ReversiRoomOptions | 'input';
    };

const BOOLEAN_FIELDS = ['fillWithBots', 'isPrivate'] as const;

/** 신뢰할 수 없는 부분 객체를 base 위에 덮어써서 검증한다. 모르는 키는 무시하고, 범위 밖이면 전체를 거부한다 */
export function parseReversiOptions(
  input: unknown,
  base: ReversiRoomOptions = DEFAULT_REVERSI_OPTIONS,
): ReversiOptionsResult {
  if (input === undefined || input === null) return { ok: true, options: base };
  if (typeof input !== 'object' || Array.isArray(input))
    return { ok: false, code: 'INVALID_OPTIONS', field: 'input' };
  const raw = input as Record<string, unknown>;
  const next: { -readonly [K in keyof ReversiRoomOptions]: ReversiRoomOptions[K] } = { ...base };
  for (const field of BOOLEAN_FIELDS) {
    if (!(field in raw)) continue;
    const value = raw[field];
    if (typeof value !== 'boolean') return { ok: false, code: 'INVALID_OPTIONS', field };
    next[field] = value;
  }
  if ('blackPolicy' in raw) {
    const value = raw.blackPolicy;
    if (!BLACK_POLICIES.some((p) => p === value))
      return { ok: false, code: 'INVALID_OPTIONS', field: 'blackPolicy' };
    next.blackPolicy = value as BlackPolicy;
  }
  if ('turnSeconds' in raw) {
    const value = raw.turnSeconds;
    if (!TURN_SECONDS_CHOICES.some((c) => c === value))
      return { ok: false, code: 'INVALID_OPTIONS', field: 'turnSeconds' };
    next.turnSeconds = value as TurnSeconds;
  }
  return { ok: true, options: Object.freeze(next) };
}

export type ReversiPhase = 'WAITING' | 'STARTING' | 'PLAYING' | 'GAME_OVER';
/** count: 돌 수로 승부, draw: 같은 수 (RV-07) */
export type ReversiResult = 'count' | 'draw';
export type ReplaceReason = 'left' | 'disconnected' | 'returned';

export interface ReversiClientMessages {
  set_ready: { readonly ready: boolean };
  start_game: Record<string, never>;
  set_options: { readonly options: Partial<ReversiRoomOptions> };
  add_bot: Record<string, never>;
  remove_bot: { readonly playerId: string };
  kick_player: { readonly playerId: string };
  rematch: Record<string, never>;
  leave_room: Record<string, never>;
  /** x, y: 0~7 (RV-01) */
  place: { readonly x: number; readonly y: number; readonly turnId: string };
}
export type ReversiClientMessageType = keyof ReversiClientMessages;

export interface ReversiServerMessages {
  welcome: { readonly playerId: string; readonly role: 'player' | 'spectator' };
  turn_start: {
    readonly playerId: string;
    readonly turnId: string;
    readonly deadline: number;
    readonly serverNow: number;
  };
  stone_placed: {
    readonly color: ReversiColor;
    readonly x: number;
    readonly y: number;
    readonly flipped: readonly { readonly x: number; readonly y: number }[];
    readonly moveNo: number;
    readonly isBot: boolean;
    /** RV-12: 시간 초과로 서버가 대신 둔 수 */
    readonly isAuto: boolean;
  };
  turn_passed: { readonly playerId: string };
  player_replaced: { readonly playerId: string; readonly nickname: string; readonly reason: ReplaceReason };
  game_over: {
    readonly result: ReversiResult;
    readonly winnerId: string | null;
    readonly black: number;
    readonly white: number;
  };
  error: { readonly code: string; readonly message: string };
}
export type ReversiServerMessageType = keyof ReversiServerMessages;
