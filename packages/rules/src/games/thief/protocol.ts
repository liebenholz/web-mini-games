/**
 * 도둑잡기 방 옵션과 메시지 타입 (docs/specs/thief.md 3장, 5장).
 * 공통 대기실 메시지(set_ready … leave_room)는 다른 게임과 같은 이름과 형태를 쓴다.
 */
import { MIN_PLAYERS } from '../../room.js';

export const THIEF_ROOM_TYPE = 'thief';
/** 2~6명, 기본 4명 (2026-11-28) */
export const THIEF_MAX_PLAYERS = 6;

export const THIEF_TURN_SECONDS = [10, 15, 30] as const;
export type ThiefTurnSeconds = (typeof THIEF_TURN_SECONDS)[number];

export interface ThiefRoomOptions {
  readonly maxPlayers: number;
  readonly turnSeconds: ThiefTurnSeconds;
  readonly fillWithBots: boolean;
  readonly isPrivate: boolean;
}

export const DEFAULT_THIEF_OPTIONS: ThiefRoomOptions = Object.freeze({
  maxPlayers: 4,
  turnSeconds: 15,
  fillWithBots: true,
  isPrivate: true,
});

export type ThiefOptionsResult =
  | { readonly ok: true; readonly options: ThiefRoomOptions }
  | {
      readonly ok: false;
      readonly code: 'INVALID_OPTIONS';
      readonly field: keyof ThiefRoomOptions | 'input';
    };

const BOOLEAN_FIELDS = ['fillWithBots', 'isPrivate'] as const;

export function parseThiefOptions(
  input: unknown,
  base: ThiefRoomOptions = DEFAULT_THIEF_OPTIONS,
): ThiefOptionsResult {
  if (input === undefined || input === null) return { ok: true, options: base };
  if (typeof input !== 'object' || Array.isArray(input))
    return { ok: false, code: 'INVALID_OPTIONS', field: 'input' };
  const raw = input as Record<string, unknown>;
  const next: { -readonly [K in keyof ThiefRoomOptions]: ThiefRoomOptions[K] } = { ...base };
  for (const field of BOOLEAN_FIELDS) {
    if (!(field in raw)) continue;
    const value = raw[field];
    if (typeof value !== 'boolean') return { ok: false, code: 'INVALID_OPTIONS', field };
    next[field] = value;
  }
  if ('turnSeconds' in raw) {
    if (!THIEF_TURN_SECONDS.some((t) => t === raw.turnSeconds))
      return { ok: false, code: 'INVALID_OPTIONS', field: 'turnSeconds' };
    next.turnSeconds = raw.turnSeconds as ThiefTurnSeconds;
  }
  if ('maxPlayers' in raw) {
    const v = raw.maxPlayers;
    if (!Number.isInteger(v) || (v as number) < MIN_PLAYERS || (v as number) > THIEF_MAX_PLAYERS)
      return { ok: false, code: 'INVALID_OPTIONS', field: 'maxPlayers' };
    next.maxPlayers = v as number;
  }
  return { ok: true, options: Object.freeze(next) };
}

export type ThiefPhase = 'WAITING' | 'STARTING' | 'PLAYING' | 'GAME_OVER';
export type ReplaceReason = 'left' | 'disconnected' | 'returned';

export interface ThiefClientMessages {
  set_ready: { readonly ready: boolean };
  start_game: Record<string, never>;
  set_options: { readonly options: Partial<ThiefRoomOptions> };
  add_bot: Record<string, never>;
  remove_bot: { readonly playerId: string };
  kick_player: { readonly playerId: string };
  rematch: Record<string, never>;
  leave_room: Record<string, never>;
  /** index: 다음 사람 패의 위치 (TF-05) */
  draw: { readonly index: number; readonly turnId: string };
}
export type ThiefClientMessageType = keyof ThiefClientMessages;

export interface ThiefServerMessages {
  welcome: { readonly playerId: string; readonly role: 'player' | 'spectator' };
  /** 본인에게만 (원칙 4) */
  your_hand: { readonly cards: readonly string[] };
  turn_start: {
    readonly playerId: string;
    readonly targetId: string;
    readonly turnId: string;
    readonly deadline: number;
    readonly serverNow: number;
  };
  /** 뽑은 카드는 짝이 맞았을 때의 숫자만 공개한다 */
  drawn: {
    readonly fromId: string;
    readonly toId: string;
    readonly matched: string | null;
    readonly drawerOut: boolean;
    readonly targetOut: boolean;
    readonly isAuto: boolean;
    readonly isBot: boolean;
  };
  player_out: { readonly playerId: string; readonly order: number };
  player_replaced: { readonly playerId: string; readonly nickname: string; readonly reason: ReplaceReason };
  game_over: {
    readonly loserId: string;
    readonly hands: readonly { readonly playerId: string; readonly cards: readonly string[] }[];
  };
  error: { readonly code: string; readonly message: string };
}
export type ThiefServerMessageType = keyof ThiefServerMessages;
