/**
 * 업다운 숫자폭탄 방 옵션과 메시지 타입 (docs/specs/updown-bomb.md 4장, 6장).
 * 공통 대기실 메시지(set_ready … leave_room)는 다른 게임과 같은 이름과 형태를 쓴다.
 */
import { MAX_PLAYERS, MIN_PLAYERS } from '../../room.js';
import type { CallResult } from './game.js';

/** 서버 방 종류 (ADR 0002). 주소 이름은 updown-bomb */
export const UPDOWN_ROOM_TYPE = 'updown_bomb';

/** 범위 1~N (UD-01) */
export const UPDOWN_RANGES = [50, 100, 200] as const;
export type UpdownRange = (typeof UPDOWN_RANGES)[number];

/** 턴 시간 (다른 게임보다 짧다, 4장) */
export const UPDOWN_TURN_SECONDS = [10, 15, 30] as const;
export type UpdownTurnSeconds = (typeof UPDOWN_TURN_SECONDS)[number];

export interface UpdownRoomOptions {
  readonly rangeMax: UpdownRange;
  readonly maxPlayers: number;
  readonly turnSeconds: UpdownTurnSeconds;
  readonly fillWithBots: boolean;
  readonly isPrivate: boolean;
}

export const DEFAULT_UPDOWN_OPTIONS: UpdownRoomOptions = Object.freeze({
  rangeMax: 100,
  maxPlayers: 6,
  turnSeconds: 15,
  fillWithBots: true,
  isPrivate: true,
});

export type UpdownOptionsResult =
  | { readonly ok: true; readonly options: UpdownRoomOptions }
  | {
      readonly ok: false;
      readonly code: 'INVALID_OPTIONS';
      readonly field: keyof UpdownRoomOptions | 'input';
    };

const BOOLEAN_FIELDS = ['fillWithBots', 'isPrivate'] as const;

/** 신뢰할 수 없는 부분 객체를 base 위에 덮어써서 검증한다. 모르는 키는 무시하고, 범위 밖이면 전체를 거부한다 */
export function parseUpdownOptions(
  input: unknown,
  base: UpdownRoomOptions = DEFAULT_UPDOWN_OPTIONS,
): UpdownOptionsResult {
  if (input === undefined || input === null) return { ok: true, options: base };
  if (typeof input !== 'object' || Array.isArray(input))
    return { ok: false, code: 'INVALID_OPTIONS', field: 'input' };
  const raw = input as Record<string, unknown>;
  const next: { -readonly [K in keyof UpdownRoomOptions]: UpdownRoomOptions[K] } = { ...base };
  for (const field of BOOLEAN_FIELDS) {
    if (!(field in raw)) continue;
    const value = raw[field];
    if (typeof value !== 'boolean') return { ok: false, code: 'INVALID_OPTIONS', field };
    next[field] = value;
  }
  if ('rangeMax' in raw) {
    if (!UPDOWN_RANGES.some((r) => r === raw.rangeMax))
      return { ok: false, code: 'INVALID_OPTIONS', field: 'rangeMax' };
    next.rangeMax = raw.rangeMax as UpdownRange;
  }
  if ('turnSeconds' in raw) {
    if (!UPDOWN_TURN_SECONDS.some((t) => t === raw.turnSeconds))
      return { ok: false, code: 'INVALID_OPTIONS', field: 'turnSeconds' };
    next.turnSeconds = raw.turnSeconds as UpdownTurnSeconds;
  }
  if ('maxPlayers' in raw) {
    const v = raw.maxPlayers;
    if (!Number.isInteger(v) || (v as number) < MIN_PLAYERS || (v as number) > MAX_PLAYERS)
      return { ok: false, code: 'INVALID_OPTIONS', field: 'maxPlayers' };
    next.maxPlayers = v as number;
  }
  return { ok: true, options: Object.freeze(next) };
}

export type UpdownPhase = 'WAITING' | 'STARTING' | 'PLAYING' | 'GAME_OVER';
export type ReplaceReason = 'left' | 'disconnected' | 'returned';

export interface UpdownClientMessages {
  set_ready: { readonly ready: boolean };
  start_game: Record<string, never>;
  set_options: { readonly options: Partial<UpdownRoomOptions> };
  add_bot: Record<string, never>;
  remove_bot: { readonly playerId: string };
  kick_player: { readonly playerId: string };
  rematch: Record<string, never>;
  leave_room: Record<string, never>;
  call_number: { readonly value: number; readonly turnId: string };
}
export type UpdownClientMessageType = keyof UpdownClientMessages;

export interface UpdownServerMessages {
  welcome: { readonly playerId: string; readonly role: 'player' | 'spectator' };
  turn_start: {
    readonly playerId: string;
    readonly turnId: string;
    readonly deadline: number;
    readonly serverNow: number;
  };
  number_called: {
    readonly playerId: string;
    readonly value: number;
    readonly result: CallResult;
    readonly low: number;
    readonly high: number;
    readonly isAuto: boolean;
    readonly isBot: boolean;
  };
  player_replaced: { readonly playerId: string; readonly nickname: string; readonly reason: ReplaceReason };
  game_over: { readonly loserId: string; readonly bomb: number; readonly forced: boolean };
  error: { readonly code: string; readonly message: string };
}
export type UpdownServerMessageType = keyof UpdownServerMessages;
