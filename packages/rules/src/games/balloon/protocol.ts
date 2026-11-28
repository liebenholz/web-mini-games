/**
 * 풍선 터뜨리기 방 옵션과 메시지 타입 (docs/specs/balloon.md 4장, 6장).
 * 공통 대기실 메시지(set_ready … leave_room)는 다른 게임과 같은 이름과 형태를 쓴다.
 */
import { MIN_PLAYERS } from '../../room.js';
import { UPDOWN_TURN_SECONDS, type UpdownTurnSeconds } from '../updown-bomb/protocol.js';

/** 서버 방 종류 (ADR 0002). 주소 이름은 balloon */
export const BALLOON_ROOM_TYPE = 'balloon';
/** 업다운처럼 이 게임만 10명까지 (2026-11-28) */
export const BALLOON_MAX_PLAYERS = 10;
export const BALLOON_TURN_SECONDS = UPDOWN_TURN_SECONDS;
export type BalloonTurnSeconds = UpdownTurnSeconds;

export interface BalloonRoomOptions {
  readonly maxPlayers: number;
  readonly turnSeconds: BalloonTurnSeconds;
  readonly fillWithBots: boolean;
  readonly isPrivate: boolean;
}

export const DEFAULT_BALLOON_OPTIONS: BalloonRoomOptions = Object.freeze({
  maxPlayers: 6,
  turnSeconds: 15,
  fillWithBots: true,
  isPrivate: true,
});

export type BalloonOptionsResult =
  | { readonly ok: true; readonly options: BalloonRoomOptions }
  | {
      readonly ok: false;
      readonly code: 'INVALID_OPTIONS';
      readonly field: keyof BalloonRoomOptions | 'input';
    };

const BOOLEAN_FIELDS = ['fillWithBots', 'isPrivate'] as const;

/** 신뢰할 수 없는 부분 객체를 base 위에 덮어써서 검증한다. 모르는 키는 무시하고, 범위 밖이면 전체를 거부한다 */
export function parseBalloonOptions(
  input: unknown,
  base: BalloonRoomOptions = DEFAULT_BALLOON_OPTIONS,
): BalloonOptionsResult {
  if (input === undefined || input === null) return { ok: true, options: base };
  if (typeof input !== 'object' || Array.isArray(input))
    return { ok: false, code: 'INVALID_OPTIONS', field: 'input' };
  const raw = input as Record<string, unknown>;
  const next: { -readonly [K in keyof BalloonRoomOptions]: BalloonRoomOptions[K] } = { ...base };
  for (const field of BOOLEAN_FIELDS) {
    if (!(field in raw)) continue;
    const value = raw[field];
    if (typeof value !== 'boolean') return { ok: false, code: 'INVALID_OPTIONS', field };
    next[field] = value;
  }
  if ('turnSeconds' in raw) {
    if (!BALLOON_TURN_SECONDS.some((t) => t === raw.turnSeconds))
      return { ok: false, code: 'INVALID_OPTIONS', field: 'turnSeconds' };
    next.turnSeconds = raw.turnSeconds as BalloonTurnSeconds;
  }
  if ('maxPlayers' in raw) {
    const v = raw.maxPlayers;
    if (!Number.isInteger(v) || (v as number) < MIN_PLAYERS || (v as number) > BALLOON_MAX_PLAYERS)
      return { ok: false, code: 'INVALID_OPTIONS', field: 'maxPlayers' };
    next.maxPlayers = v as number;
  }
  return { ok: true, options: Object.freeze(next) };
}

export type BalloonPhase = 'WAITING' | 'STARTING' | 'PLAYING' | 'GAME_OVER';
export type ReplaceReason = 'left' | 'disconnected' | 'returned';

export interface BalloonClientMessages {
  set_ready: { readonly ready: boolean };
  start_game: Record<string, never>;
  set_options: { readonly options: Partial<BalloonRoomOptions> };
  add_bot: Record<string, never>;
  remove_bot: { readonly playerId: string };
  kick_player: { readonly playerId: string };
  rematch: Record<string, never>;
  leave_room: Record<string, never>;
  pump: { readonly turnId: string };
  end_turn: { readonly turnId: string };
}
export type BalloonClientMessageType = keyof BalloonClientMessages;

export interface BalloonServerMessages {
  welcome: { readonly playerId: string; readonly role: 'player' | 'spectator' };
  turn_start: {
    readonly playerId: string;
    readonly turnId: string;
    readonly deadline: number;
    readonly serverNow: number;
  };
  pumped: {
    readonly playerId: string;
    readonly total: number;
    readonly turnPumps: number;
    readonly popped: boolean;
    readonly isAuto: boolean;
    readonly isBot: boolean;
  };
  player_replaced: { readonly playerId: string; readonly nickname: string; readonly reason: ReplaceReason };
  game_over: { readonly loserId: string; readonly threshold: number };
  error: { readonly code: string; readonly message: string };
}
export type BalloonServerMessageType = keyof BalloonServerMessages;
