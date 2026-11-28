/**
 * 요트 주사위 방 옵션과 메시지 타입 (docs/specs/yacht.md 4장, 6장).
 * 공통 대기실 메시지(set_ready … leave_room)는 다른 게임과 같은 이름과 형태를 쓴다.
 */
import { MIN_PLAYERS } from '../../room.js';

/** 서버 방 종류 (ADR 0002). 주소 이름은 yacht */
export const YACHT_ROOM_TYPE = 'yacht';
/** 기본 2명, 최대 4명 (2026-11-28) */
export const YACHT_MAX_PLAYERS = 4;

export const YACHT_TURN_SECONDS = [30, 45, 60] as const;
export type YachtTurnSeconds = (typeof YACHT_TURN_SECONDS)[number];

export interface YachtRoomOptions {
  readonly maxPlayers: number;
  readonly turnSeconds: YachtTurnSeconds;
  readonly fillWithBots: boolean;
  readonly isPrivate: boolean;
}

export const DEFAULT_YACHT_OPTIONS: YachtRoomOptions = Object.freeze({
  maxPlayers: 2,
  turnSeconds: 45,
  fillWithBots: true,
  isPrivate: true,
});

export type YachtOptionsResult =
  | { readonly ok: true; readonly options: YachtRoomOptions }
  | {
      readonly ok: false;
      readonly code: 'INVALID_OPTIONS';
      readonly field: keyof YachtRoomOptions | 'input';
    };

const BOOLEAN_FIELDS = ['fillWithBots', 'isPrivate'] as const;

/** 신뢰할 수 없는 부분 객체를 base 위에 덮어써서 검증한다. 모르는 키는 무시하고, 범위 밖이면 전체를 거부한다 */
export function parseYachtOptions(
  input: unknown,
  base: YachtRoomOptions = DEFAULT_YACHT_OPTIONS,
): YachtOptionsResult {
  if (input === undefined || input === null) return { ok: true, options: base };
  if (typeof input !== 'object' || Array.isArray(input))
    return { ok: false, code: 'INVALID_OPTIONS', field: 'input' };
  const raw = input as Record<string, unknown>;
  const next: { -readonly [K in keyof YachtRoomOptions]: YachtRoomOptions[K] } = { ...base };
  for (const field of BOOLEAN_FIELDS) {
    if (!(field in raw)) continue;
    const value = raw[field];
    if (typeof value !== 'boolean') return { ok: false, code: 'INVALID_OPTIONS', field };
    next[field] = value;
  }
  if ('turnSeconds' in raw) {
    if (!YACHT_TURN_SECONDS.some((t) => t === raw.turnSeconds))
      return { ok: false, code: 'INVALID_OPTIONS', field: 'turnSeconds' };
    next.turnSeconds = raw.turnSeconds as YachtTurnSeconds;
  }
  if ('maxPlayers' in raw) {
    const v = raw.maxPlayers;
    if (!Number.isInteger(v) || (v as number) < MIN_PLAYERS || (v as number) > YACHT_MAX_PLAYERS)
      return { ok: false, code: 'INVALID_OPTIONS', field: 'maxPlayers' };
    next.maxPlayers = v as number;
  }
  return { ok: true, options: Object.freeze(next) };
}

export type YachtPhase = 'WAITING' | 'STARTING' | 'PLAYING' | 'GAME_OVER';
export type ReplaceReason = 'left' | 'disconnected' | 'returned';

export interface YachtClientMessages {
  set_ready: { readonly ready: boolean };
  start_game: Record<string, never>;
  set_options: { readonly options: Partial<YachtRoomOptions> };
  add_bot: Record<string, never>;
  remove_bot: { readonly playerId: string };
  kick_player: { readonly playerId: string };
  rematch: Record<string, never>;
  leave_room: Record<string, never>;
  /** keep: 남길 주사위 5개. 첫 굴림은 모두 false (YT-02) */
  roll: { readonly keep: readonly boolean[]; readonly turnId: string };
  /** category: 0~11 (YT-03) */
  score: { readonly category: number; readonly turnId: string };
}
export type YachtClientMessageType = keyof YachtClientMessages;

export interface YachtServerMessages {
  welcome: { readonly playerId: string; readonly role: 'player' | 'spectator' };
  turn_start: {
    readonly playerId: string;
    readonly turnId: string;
    readonly deadline: number;
    readonly serverNow: number;
  };
  dice_rolled: {
    readonly playerId: string;
    readonly dice: readonly number[];
    readonly held: readonly boolean[];
    readonly rollNo: number;
    readonly isAuto: boolean;
    readonly isBot: boolean;
  };
  scored: {
    readonly playerId: string;
    readonly category: number;
    readonly points: number;
    readonly upperSum: number;
    readonly bonus: number;
    readonly total: number;
    readonly isAuto: boolean;
    readonly isBot: boolean;
  };
  player_replaced: { readonly playerId: string; readonly nickname: string; readonly reason: ReplaceReason };
  game_over: {
    readonly ranking: readonly { readonly playerId: string; readonly total: number; readonly rank: number }[];
  };
  error: { readonly code: string; readonly message: string };
}
export type YachtServerMessageType = keyof YachtServerMessages;
