/** 명세 4장: 방 옵션, 방 코드, 닉네임 규칙. 서버 검증과 클라이언트 UI가 함께 쓴다. */

export const TURN_SECONDS_CHOICES = [15, 30, 60] as const;
export type TurnSeconds = (typeof TURN_SECONDS_CHOICES)[number];

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export interface RoomOptions {
  /** 2~6 */
  readonly maxPlayers: number;
  /** 시작할 때 빈자리를 봇으로 채운다 */
  readonly fillWithBots: boolean;
  readonly turnSeconds: TurnSeconds;
  /** 3~5 (R-01) */
  readonly startingDice: number;
  readonly isPrivate: boolean;
}

export const DEFAULT_ROOM_OPTIONS: RoomOptions = Object.freeze({
  maxPlayers: 6,
  fillWithBots: true,
  turnSeconds: 30,
  startingDice: 5,
  isPrivate: true,
});

export type RoomOptionsResult =
  | { readonly ok: true; readonly options: RoomOptions }
  | { readonly ok: false; readonly code: 'INVALID_OPTIONS'; readonly field: keyof RoomOptions | 'input' };

function isIntIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * 신뢰할 수 없는 입력(부분 객체)을 `base` 위에 덮어써서 검증한다.
 * 모르는 키는 무시한다. 값이 범위를 벗어나면 전체를 거부한다.
 */
export function parseRoomOptions(
  input: unknown,
  base: RoomOptions = DEFAULT_ROOM_OPTIONS,
): RoomOptionsResult {
  if (input === undefined || input === null) return { ok: true, options: base };
  if (typeof input !== 'object' || Array.isArray(input))
    return { ok: false, code: 'INVALID_OPTIONS', field: 'input' };
  const raw = input as Record<string, unknown>;
  const next = { ...base };

  if ('maxPlayers' in raw) {
    if (!isIntIn(raw.maxPlayers, MIN_PLAYERS, MAX_PLAYERS))
      return { ok: false, code: 'INVALID_OPTIONS', field: 'maxPlayers' };
    next.maxPlayers = raw.maxPlayers;
  }
  if ('fillWithBots' in raw) {
    if (typeof raw.fillWithBots !== 'boolean')
      return { ok: false, code: 'INVALID_OPTIONS', field: 'fillWithBots' };
    next.fillWithBots = raw.fillWithBots;
  }
  if ('turnSeconds' in raw) {
    const value = raw.turnSeconds;
    if (!TURN_SECONDS_CHOICES.some((c) => c === value))
      return { ok: false, code: 'INVALID_OPTIONS', field: 'turnSeconds' };
    next.turnSeconds = value as TurnSeconds;
  }
  if ('startingDice' in raw) {
    if (!isIntIn(raw.startingDice, 3, 5))
      return { ok: false, code: 'INVALID_OPTIONS', field: 'startingDice' };
    next.startingDice = raw.startingDice;
  }
  if ('isPrivate' in raw) {
    if (typeof raw.isPrivate !== 'boolean') return { ok: false, code: 'INVALID_OPTIONS', field: 'isPrivate' };
    next.isPrivate = raw.isPrivate;
  }
  return { ok: true, options: Object.freeze(next) };
}

/** 영문 대문자와 숫자 중 혼동되는 0, O, 1, I를 뺀 32자 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

/** 난수 인덱스(0..31) 6개로 방 코드를 만든다. 난수 생성은 호출 측(서버) 책임이다. */
export function roomCodeFromIndices(indices: readonly number[]): string {
  if (indices.length !== ROOM_CODE_LENGTH) throw new RangeError('room code needs 6 indices');
  return indices
    .map((i) => {
      const ch = ROOM_CODE_ALPHABET[i];
      if (ch === undefined) throw new RangeError(`index ${i} out of range`);
      return ch;
    })
    .join('');
}

/** 사용자가 입력한 코드를 정규화한다 (공백 제거, 대문자). 형식이 맞지 않으면 null. */
export function normalizeRoomCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const code = input.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 12;

/** 명세 8장: 닉네임 2~12자 (공백 앞뒤 제거, 글자 수는 코드 포인트 기준). 제어 문자는 거부한다. */
export function normalizeNickname(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const name = input.normalize('NFC').trim().replace(/\s+/g, ' ');
  const length = [...name].length;
  if (length < NICKNAME_MIN || length > NICKNAME_MAX) return null;
  for (const ch of name) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isForbiddenCodePoint(cp)) return null;
  }
  return name;
}

/** 제어 문자, 폭 없는 문자, 방향 제어 문자 (닉네임 위장 방지) */
function isForbiddenCodePoint(cp: number): boolean {
  return (
    cp <= 0x1f ||
    (cp >= 0x7f && cp <= 0x9f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x2028 && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069) ||
    cp === 0xfeff
  );
}
