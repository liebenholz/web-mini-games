/**
 * 보물 찾기 방 옵션과 메시지 타입 (docs/specs/treasure.md 4장, 6장).
 * 공통 대기실 메시지(set_ready … leave_room)는 다른 게임과 같은 이름과 형태를 쓴다.
 */
import { MIN_PLAYERS } from '../../room.js';

/** 서버 방 종류 (ADR 0002). 주소 이름은 treasure */
export const TREASURE_ROOM_TYPE = 'treasure';
/** 업다운·풍선처럼 이 게임도 10명까지 (2026-11-28) */
export const TREASURE_MAX_PLAYERS = 10;

export const TREASURE_PICK_SECONDS = [10, 15, 30] as const;
export type TreasurePickSeconds = (typeof TREASURE_PICK_SECONDS)[number];

export interface TreasureRoomOptions {
  readonly maxPlayers: number;
  readonly pickSeconds: TreasurePickSeconds;
  readonly fillWithBots: boolean;
  readonly isPrivate: boolean;
}

export const DEFAULT_TREASURE_OPTIONS: TreasureRoomOptions = Object.freeze({
  maxPlayers: 6,
  pickSeconds: 15,
  fillWithBots: true,
  isPrivate: true,
});

export type TreasureOptionsResult =
  | { readonly ok: true; readonly options: TreasureRoomOptions }
  | {
      readonly ok: false;
      readonly code: 'INVALID_OPTIONS';
      readonly field: keyof TreasureRoomOptions | 'input';
    };

const BOOLEAN_FIELDS = ['fillWithBots', 'isPrivate'] as const;

/** 신뢰할 수 없는 부분 객체를 base 위에 덮어써서 검증한다. 모르는 키는 무시하고, 범위 밖이면 전체를 거부한다 */
export function parseTreasureOptions(
  input: unknown,
  base: TreasureRoomOptions = DEFAULT_TREASURE_OPTIONS,
): TreasureOptionsResult {
  if (input === undefined || input === null) return { ok: true, options: base };
  if (typeof input !== 'object' || Array.isArray(input))
    return { ok: false, code: 'INVALID_OPTIONS', field: 'input' };
  const raw = input as Record<string, unknown>;
  const next: { -readonly [K in keyof TreasureRoomOptions]: TreasureRoomOptions[K] } = { ...base };
  for (const field of BOOLEAN_FIELDS) {
    if (!(field in raw)) continue;
    const value = raw[field];
    if (typeof value !== 'boolean') return { ok: false, code: 'INVALID_OPTIONS', field };
    next[field] = value;
  }
  if ('pickSeconds' in raw) {
    if (!TREASURE_PICK_SECONDS.some((t) => t === raw.pickSeconds))
      return { ok: false, code: 'INVALID_OPTIONS', field: 'pickSeconds' };
    next.pickSeconds = raw.pickSeconds as TreasurePickSeconds;
  }
  if ('maxPlayers' in raw) {
    const v = raw.maxPlayers;
    if (!Number.isInteger(v) || (v as number) < MIN_PLAYERS || (v as number) > TREASURE_MAX_PLAYERS)
      return { ok: false, code: 'INVALID_OPTIONS', field: 'maxPlayers' };
    next.maxPlayers = v as number;
  }
  return { ok: true, options: Object.freeze(next) };
}

export type TreasurePhase = 'WAITING' | 'STARTING' | 'PICKING' | 'REVEAL' | 'GAME_OVER';
export type ReplaceReason = 'left' | 'disconnected' | 'returned';

export interface TreasureClientMessages {
  set_ready: { readonly ready: boolean };
  start_game: Record<string, never>;
  set_options: { readonly options: Partial<TreasureRoomOptions> };
  add_bot: Record<string, never>;
  remove_bot: { readonly playerId: string };
  kick_player: { readonly playerId: string };
  rematch: Record<string, never>;
  leave_room: Record<string, never>;
  pick: { readonly x: number; readonly y: number; readonly roundId: string };
  lock_pick: { readonly roundId: string };
}
export type TreasureClientMessageType = keyof TreasureClientMessages;

export interface RevealedPick {
  readonly playerId: string;
  readonly x: number;
  readonly y: number;
  readonly distSq: number;
  readonly isAuto: boolean;
}

export interface TreasureServerMessages {
  welcome: { readonly playerId: string; readonly role: 'player' | 'spectator' };
  round_start: {
    readonly roundId: string;
    readonly participants: readonly string[];
    readonly deadline: number;
    readonly serverNow: number;
    readonly replay: number;
  };
  /** 본인에게만: 서버가 받아 둔 내 선택 (BH-21) */
  your_pick: { readonly roundId: string; readonly x: number; readonly y: number; readonly locked: boolean };
  /** 전체: 확정했다는 사실만 (칸은 없다) */
  pick_locked: { readonly playerId: string };
  reveal: {
    readonly roundId: string;
    readonly treasure: { readonly x: number; readonly y: number };
    readonly picks: readonly RevealedPick[];
    readonly far: readonly string[];
    readonly tie: boolean;
    readonly replay: number;
  };
  player_replaced: { readonly playerId: string; readonly nickname: string; readonly reason: ReplaceReason };
  game_over: {
    readonly loserId: string;
    readonly treasure: { readonly x: number; readonly y: number };
    readonly tieBreak: boolean;
  };
  error: { readonly code: string; readonly message: string };
}
export type TreasureServerMessageType = keyof TreasureServerMessages;
