/**
 * 오목 방 옵션과 메시지 타입 (docs/specs/gomoku.md 4장, 6장).
 * 공통 대기실 메시지(set_ready, start_game, set_options, add_bot, remove_bot, kick_player, rematch, leave_room)는
 * 거짓말쟁이 주사위와 같은 이름과 형태를 쓴다.
 */
import { TURN_SECONDS_CHOICES, type TurnSeconds } from '../../room.js';
import type { GomokuColor } from './board.js';
import { DEFAULT_GOMOKU_RULES, type GomokuRuleOptions } from './rules.js';

/** 서버 방 종류이자 주소 이름 (ADR 0002) */
export const GOMOKU_ROOM_TYPE = 'gomoku';
export const GOMOKU_PLAYERS = 2;

/** 누가 흑을 맡는가 (G-02): 방장 / 상대 / 무작위 */
export const BLACK_POLICIES = ['host', 'guest', 'random'] as const;
export type BlackPolicy = (typeof BLACK_POLICIES)[number];

export interface GomokuRoomOptions extends GomokuRuleOptions {
  readonly blackPolicy: BlackPolicy;
  readonly turnSeconds: TurnSeconds;
  readonly fillWithBots: boolean;
  readonly isPrivate: boolean;
}

export const DEFAULT_GOMOKU_OPTIONS: GomokuRoomOptions = Object.freeze({
  ...DEFAULT_GOMOKU_RULES,
  blackPolicy: 'random',
  turnSeconds: 30,
  fillWithBots: true,
  isPrivate: true,
});

export type GomokuOptionsResult =
  | { readonly ok: true; readonly options: GomokuRoomOptions }
  | {
      readonly ok: false;
      readonly code: 'INVALID_OPTIONS';
      readonly field: keyof GomokuRoomOptions | 'input';
    };

const BOOLEAN_FIELDS = [
  'forbidDoubleThree',
  'forbidDoubleFour',
  'forbidOverline',
  'fillWithBots',
  'isPrivate',
] as const;

/** 신뢰할 수 없는 부분 객체를 base 위에 덮어써서 검증한다. 모르는 키는 무시하고, 범위 밖이면 전체를 거부한다 */
export function parseGomokuOptions(
  input: unknown,
  base: GomokuRoomOptions = DEFAULT_GOMOKU_OPTIONS,
): GomokuOptionsResult {
  if (input === undefined || input === null) return { ok: true, options: base };
  if (typeof input !== 'object' || Array.isArray(input))
    return { ok: false, code: 'INVALID_OPTIONS', field: 'input' };
  const raw = input as Record<string, unknown>;
  const next: { -readonly [K in keyof GomokuRoomOptions]: GomokuRoomOptions[K] } = { ...base };
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

/** 금수 조합 이름 (대기실 표시용, 명세 4장) */
export function ruleSetName(rules: GomokuRuleOptions): '렌주' | '자유 오목' | '사용자 설정' {
  const on = [rules.forbidDoubleThree, rules.forbidDoubleFour, rules.forbidOverline];
  if (on.every(Boolean)) return '렌주';
  if (on.every((v) => !v)) return '자유 오목';
  return '사용자 설정';
}

export type GomokuPhase = 'WAITING' | 'STARTING' | 'PLAYING' | 'GAME_OVER';
export type GomokuResult = 'five' | 'timeout' | 'draw';
/** G-22, G-23: 상대에게 알리는 이유 */
export type ReplaceReason = 'left' | 'disconnected' | 'returned';

export interface GomokuClientMessages {
  set_ready: { readonly ready: boolean };
  start_game: Record<string, never>;
  set_options: { readonly options: Partial<GomokuRoomOptions> };
  add_bot: Record<string, never>;
  remove_bot: { readonly playerId: string };
  kick_player: { readonly playerId: string };
  rematch: Record<string, never>;
  leave_room: Record<string, never>;
  /** x, y: 0~14 (G-01) */
  place: { readonly x: number; readonly y: number; readonly turnId: string };
}
export type GomokuClientMessageType = keyof GomokuClientMessages;

export interface GomokuServerMessages {
  welcome: { readonly playerId: string; readonly role: 'player' | 'spectator' };
  turn_start: {
    readonly playerId: string;
    readonly turnId: string;
    readonly deadline: number;
    readonly serverNow: number;
  };
  stone_placed: {
    readonly color: GomokuColor;
    readonly x: number;
    readonly y: number;
    readonly moveNo: number;
    readonly isBot: boolean;
  };
  player_replaced: { readonly playerId: string; readonly nickname: string; readonly reason: ReplaceReason };
  game_over: {
    readonly result: GomokuResult;
    readonly winnerId: string | null;
    readonly line: readonly { readonly x: number; readonly y: number }[];
  };
  error: { readonly code: string; readonly message: string };
}
export type GomokuServerMessageType = keyof GomokuServerMessages;
