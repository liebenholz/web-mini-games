/**
 * 원카드 방 옵션과 메시지 타입 (docs/specs/one-card.md 7장, 9장).
 * 공통 대기실 메시지는 거짓말쟁이 주사위·오목과 같은 이름과 형태를 쓴다.
 */
import { MAX_PLAYERS, MIN_PLAYERS, TURN_SECONDS_CHOICES, type TurnSeconds } from '../../room.js';
import type { Card, Suit } from './cards.js';
import type { DrawReason } from './game.js';

/** 서버 방 종류 (ADR 0002). 주소는 one-card */
export const ONE_CARD_ROOM_TYPE = 'one_card';
/** C-30: 원카드 창 길이 */
export const ONE_CARD_WINDOW_MS = 3000;
/** C-53: 가져온 뒤 최소 남은 시간 */
export const MIN_TIME_AFTER_DRAW_MS = 5000;

export interface OneCardRoomOptions {
  readonly maxPlayers: number;
  readonly turnSeconds: TurnSeconds;
  readonly fillWithBots: boolean;
  readonly isPrivate: boolean;
}

export const DEFAULT_ONE_CARD_OPTIONS: OneCardRoomOptions = Object.freeze({
  maxPlayers: 4,
  turnSeconds: 30,
  fillWithBots: true,
  isPrivate: true,
});

export type OneCardOptionsResult =
  | { readonly ok: true; readonly options: OneCardRoomOptions }
  | {
      readonly ok: false;
      readonly code: 'INVALID_OPTIONS';
      readonly field: keyof OneCardRoomOptions | 'input';
    };

/** 신뢰할 수 없는 부분 객체를 base 위에 덮어써서 검증한다. 모르는 키는 무시하고, 범위 밖이면 전체를 거부한다 */
export function parseOneCardOptions(
  input: unknown,
  base: OneCardRoomOptions = DEFAULT_ONE_CARD_OPTIONS,
): OneCardOptionsResult {
  if (input === undefined || input === null) return { ok: true, options: base };
  if (typeof input !== 'object' || Array.isArray(input))
    return { ok: false, code: 'INVALID_OPTIONS', field: 'input' };
  const raw = input as Record<string, unknown>;
  const next: { -readonly [K in keyof OneCardRoomOptions]: OneCardRoomOptions[K] } = { ...base };
  for (const field of ['fillWithBots', 'isPrivate'] as const) {
    if (!(field in raw)) continue;
    const value = raw[field];
    if (typeof value !== 'boolean') return { ok: false, code: 'INVALID_OPTIONS', field };
    next[field] = value;
  }
  if ('maxPlayers' in raw) {
    const value = raw.maxPlayers;
    if (!Number.isInteger(value) || (value as number) < MIN_PLAYERS || (value as number) > MAX_PLAYERS)
      return { ok: false, code: 'INVALID_OPTIONS', field: 'maxPlayers' };
    next.maxPlayers = value as number;
  }
  if ('turnSeconds' in raw) {
    const value = raw.turnSeconds;
    if (!TURN_SECONDS_CHOICES.some((c) => c === value))
      return { ok: false, code: 'INVALID_OPTIONS', field: 'turnSeconds' };
    next.turnSeconds = value as TurnSeconds;
  }
  return { ok: true, options: Object.freeze(next) };
}

export type OneCardPhase = 'WAITING' | 'STARTING' | 'PLAYING' | 'GAME_OVER';
export type ReplaceReason = 'left' | 'disconnected' | 'returned';

export interface OneCardClientMessages {
  set_ready: { readonly ready: boolean };
  start_game: Record<string, never>;
  set_options: { readonly options: Partial<OneCardRoomOptions> };
  add_bot: Record<string, never>;
  remove_bot: { readonly playerId: string };
  kick_player: { readonly playerId: string };
  rematch: Record<string, never>;
  leave_room: Record<string, never>;
  /** suit는 7일 때만 (C-12) */
  play: { readonly card: Card; readonly suit?: Suit; readonly turnId: string };
  draw: { readonly turnId: string };
  pass: { readonly turnId: string };
  call_one_card: { readonly windowId: string };
}
export type OneCardClientMessageType = keyof OneCardClientMessages;

export interface OneCardServerMessages {
  welcome: { readonly playerId: string; readonly role: 'player' | 'spectator' };
  /** C-40: 본인 패. 본인에게만 */
  your_hand: { readonly cards: readonly Card[]; readonly drawn: Card | null };
  turn_start: {
    readonly playerId: string;
    readonly turnId: string;
    readonly deadline: number;
    readonly serverNow: number;
    readonly attack: number;
  };
  card_played: {
    readonly playerId: string;
    readonly card: Card;
    readonly suit: Suit | null;
    readonly left: number;
    readonly isAuto: boolean;
  };
  /** C-42: 카드는 넣지 않는다 */
  cards_drawn: { readonly playerId: string; readonly count: number; readonly reason: DrawReason };
  one_card_window: { readonly windowId: string; readonly playerId: string; readonly closesAt: number };
  one_card_called: {
    readonly windowId: string;
    readonly callerId: string | null;
    readonly playerId: string;
    readonly result: 'safe' | 'penalty' | 'expired';
  };
  player_finished: { readonly playerId: string; readonly rank: number };
  player_bankrupt: { readonly playerId: string };
  player_replaced: { readonly playerId: string; readonly nickname: string; readonly reason: ReplaceReason };
  game_over: {
    readonly ranking: readonly {
      readonly playerId: string;
      readonly rank: number;
      readonly bankrupt: boolean;
    }[];
  };
  error: { readonly code: string; readonly message: string };
}
export type OneCardServerMessageType = keyof OneCardServerMessages;
