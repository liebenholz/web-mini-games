/**
 * 숫자야구 방 옵션과 메시지 타입 (docs/specs/bulls-and-cows.md 4장, 6장).
 * 공통 대기실 메시지는 다른 게임과 같은 이름과 형태를 쓴다.
 */
import { TURN_SECONDS_CHOICES, type TurnSeconds } from '../../room.js';
import { DIGIT_CHOICES, type Digits } from './game.js';

/** 서버 방 종류 (ADR 0002). 주소는 bulls-and-cows */
export const BULLS_ROOM_TYPE = 'bulls_and_cows';
export const BULLS_PLAYERS = 2;
/** B-30: 비밀 숫자를 정하는 시간 (고정) */
export const SECRET_MS = 60_000;
/** B-08: 0은 제한 없음 */
export const MAX_ATTEMPT_CHOICES = [10, 15, 0] as const;
export type MaxAttempts = (typeof MAX_ATTEMPT_CHOICES)[number];

export interface BullsRoomOptions {
  readonly digits: Digits;
  readonly maxAttempts: MaxAttempts;
  readonly turnSeconds: TurnSeconds;
  readonly fillWithBots: boolean;
  readonly isPrivate: boolean;
}

export const DEFAULT_BULLS_OPTIONS: BullsRoomOptions = Object.freeze({
  digits: 3,
  maxAttempts: 10,
  turnSeconds: 30,
  fillWithBots: true,
  isPrivate: true,
});

export type BullsOptionsResult =
  | { readonly ok: true; readonly options: BullsRoomOptions }
  | {
      readonly ok: false;
      readonly code: 'INVALID_OPTIONS';
      readonly field: keyof BullsRoomOptions | 'input';
    };

/** 신뢰할 수 없는 부분 객체를 base 위에 덮어써서 검증한다. 모르는 키는 무시하고, 범위 밖이면 전체를 거부한다 */
export function parseBullsOptions(
  input: unknown,
  base: BullsRoomOptions = DEFAULT_BULLS_OPTIONS,
): BullsOptionsResult {
  if (input === undefined || input === null) return { ok: true, options: base };
  if (typeof input !== 'object' || Array.isArray(input))
    return { ok: false, code: 'INVALID_OPTIONS', field: 'input' };
  const raw = input as Record<string, unknown>;
  const next: { -readonly [K in keyof BullsRoomOptions]: BullsRoomOptions[K] } = { ...base };
  for (const field of ['fillWithBots', 'isPrivate'] as const) {
    if (!(field in raw)) continue;
    const value = raw[field];
    if (typeof value !== 'boolean') return { ok: false, code: 'INVALID_OPTIONS', field };
    next[field] = value;
  }
  if ('digits' in raw) {
    if (!DIGIT_CHOICES.some((c) => c === raw.digits))
      return { ok: false, code: 'INVALID_OPTIONS', field: 'digits' };
    next.digits = raw.digits as Digits;
  }
  if ('maxAttempts' in raw) {
    if (!MAX_ATTEMPT_CHOICES.some((c) => c === raw.maxAttempts))
      return { ok: false, code: 'INVALID_OPTIONS', field: 'maxAttempts' };
    next.maxAttempts = raw.maxAttempts as MaxAttempts;
  }
  if ('turnSeconds' in raw) {
    if (!TURN_SECONDS_CHOICES.some((c) => c === raw.turnSeconds))
      return { ok: false, code: 'INVALID_OPTIONS', field: 'turnSeconds' };
    next.turnSeconds = raw.turnSeconds as TurnSeconds;
  }
  return { ok: true, options: Object.freeze(next) };
}

export type BullsPhase = 'WAITING' | 'STARTING' | 'SECRET' | 'PLAYING' | 'GAME_OVER';
export type BullsEndResult = 'solved' | 'draw';
export type ReplaceReason = 'left' | 'disconnected' | 'returned';

export interface BullsClientMessages {
  set_ready: { readonly ready: boolean };
  start_game: Record<string, never>;
  set_options: { readonly options: Partial<BullsRoomOptions> };
  add_bot: Record<string, never>;
  remove_bot: { readonly playerId: string };
  kick_player: { readonly playerId: string };
  rematch: Record<string, never>;
  leave_room: Record<string, never>;
  set_secret: { readonly digits: string };
  random_secret: Record<string, never>;
  guess: { readonly digits: string; readonly turnId: string };
}
export type BullsClientMessageType = keyof BullsClientMessages;

export interface BullsServerMessages {
  welcome: { readonly playerId: string; readonly role: 'player' | 'spectator' };
  /** B-21: 본인에게만 */
  your_secret: { readonly digits: string };
  turn_start: {
    readonly playerId: string;
    readonly turnId: string;
    readonly deadline: number;
    readonly serverNow: number;
    readonly lastChance: boolean;
  };
  guess_result: {
    readonly playerId: string;
    readonly guess: string;
    readonly strikes: number;
    readonly balls: number;
    readonly attempt: number;
    readonly isAuto: boolean;
  };
  turn_skipped: { readonly playerId: string; readonly attempt: number };
  last_chance: { readonly playerId: string };
  player_replaced: { readonly playerId: string; readonly nickname: string; readonly reason: ReplaceReason };
  /** B-23: 끝나면 두 비밀 숫자를 공개한다 */
  game_over: {
    readonly result: BullsEndResult;
    readonly winnerId: string | null;
    readonly secrets: Readonly<Record<string, string>>;
    readonly attempts: Readonly<Record<string, number>>;
  };
  error: { readonly code: string; readonly message: string };
}
export type BullsServerMessageType = keyof BullsServerMessages;
