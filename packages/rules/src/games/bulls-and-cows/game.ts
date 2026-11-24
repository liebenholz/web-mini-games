/**
 * 숫자야구 규칙 (docs/specs/bulls-and-cows.md 2장). 순수 함수만 둔다.
 * 비밀 숫자를 무작위로 정할 때와 봇이 후보를 고를 때 쓰는 난수는 pick(n)으로 받는다 (0 이상 n 미만 정수).
 */

export const DIGIT_CHOICES = [3, 4] as const;
export type Digits = (typeof DIGIT_CHOICES)[number];

export interface Score {
  /** 숫자와 자리가 같은 개수 (3자리 S, 4자리 Bull) */
  readonly strikes: number;
  /** 숫자는 있지만 자리가 다른 개수 (3자리 B, 4자리 Cow) */
  readonly balls: number;
}

export type Pick = (n: number) => number;

/** B-01, B-02: 자릿수만큼 0~9, 중복 없음. 맨 앞 0 허용 */
export function isValidNumber(value: unknown, digits: Digits): value is string {
  if (typeof value !== 'string' || value.length !== digits || !/^\d+$/.test(value)) return false;
  return new Set(value).size === digits;
}

/** B-03 */
export function score(secret: string, guess: string): Score {
  let strikes = 0;
  let balls = 0;
  for (let i = 0; i < guess.length; i += 1) {
    const d = guess[i] as string;
    if (secret[i] === d) strikes += 1;
    else if (secret.includes(d)) balls += 1;
  }
  return { strikes, balls };
}

/** B-05 */
export function isSolved(s: Score, digits: Digits): boolean {
  return s.strikes === digits;
}

/**
 * B-11: 결과 표기. 3자리는 숫자야구 식(0 생략, 없으면 OUT), 4자리는 Bulls and Cows 식(0도 표기)
 */
export function formatScore(s: Score, digits: Digits): string {
  if (digits === 4) return `${s.strikes}B ${s.balls}C`;
  if (s.strikes === 0 && s.balls === 0) return 'OUT';
  return [s.strikes > 0 ? `${s.strikes}S` : '', s.balls > 0 ? `${s.balls}B` : ''].filter(Boolean).join(' ');
}

/** 가능한 모든 숫자 (3자리 720개, 4자리 5040개) */
export function allNumbers(digits: Digits): string[] {
  const out: string[] = [];
  const walk = (prefix: string) => {
    if (prefix.length === digits) {
      out.push(prefix);
      return;
    }
    for (let d = 0; d <= 9; d += 1) if (!prefix.includes(String(d))) walk(prefix + d);
  };
  walk('');
  return out;
}

/** B-30, B-36: 무작위 비밀 숫자 */
export function randomNumber(digits: Digits, pick: Pick): string {
  const pool = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  let out = '';
  for (let i = 0; i < digits; i += 1) out += pool.splice(pick(pool.length), 1)[0] as string;
  return out;
}

export interface GuessRecord {
  /** 0 = 선공, 1 = 후공 */
  readonly seat: 0 | 1;
  /** 시간 초과로 넘긴 턴이면 null (B-09) */
  readonly guess: string | null;
  readonly strikes: number;
  readonly balls: number;
}

/** 진행 상태. 비밀 숫자를 담고 있으므로 서버만 가진다 (B-20) */
export interface BullsState {
  readonly digits: Digits;
  /** 0이면 제한 없음 (B-08) */
  readonly maxAttempts: number;
  /** 자리 0이 선공, 1이 후공 (B-06) */
  readonly secrets: readonly [string, string];
  readonly turn: 0 | 1;
  readonly attempts: readonly [number, number];
  readonly history: readonly GuessRecord[];
  /** B-07: 선공이 맞혀서 후공이 마지막 기회를 쓰는 중 */
  readonly lastChance: boolean;
  readonly over: boolean;
  readonly result: 'solved' | 'draw' | null;
  /** 이긴 자리. 무승부면 null */
  readonly winner: 0 | 1 | null;
}

export type BullsErrorCode = 'NOT_YOUR_TURN' | 'INVALID_GUESS' | 'INVALID_STATE';

export type BullsResult =
  | { readonly ok: true; readonly state: BullsState; readonly record: GuessRecord }
  | { readonly ok: false; readonly code: BullsErrorCode };

export function startBulls(
  digits: Digits,
  maxAttempts: number,
  secrets: readonly [string, string],
): BullsState {
  if (!isValidNumber(secrets[0], digits) || !isValidNumber(secrets[1], digits)) throw new Error('bad secret');
  return {
    digits,
    maxAttempts,
    secrets,
    turn: 0,
    attempts: [0, 0],
    history: [],
    lastChance: false,
    over: false,
    result: null,
    winner: null,
  };
}

const other = (seat: 0 | 1): 0 | 1 => (seat === 0 ? 1 : 0);

/** 추측 하나 또는 넘긴 턴 하나를 반영하고 다음 차례·승부를 정한다 (B-07, B-08) */
function advance(s: BullsState, record: GuessRecord): BullsState {
  const seat = record.seat;
  const attempts: [number, number] = [s.attempts[0], s.attempts[1]];
  attempts[seat] += 1;
  const solved = record.guess !== null && isSolved(record, s.digits);
  const base = { ...s, attempts, history: [...s.history, record] };
  const end = (result: 'solved' | 'draw', winner: 0 | 1 | null): BullsState => ({
    ...base,
    over: true,
    result,
    winner,
    lastChance: false,
  });

  if (seat === 1) {
    // 후공: 맞히면 이긴다. 선공도 이미 맞혔으면(마지막 기회) 무승부
    if (s.lastChance) return solved ? end('draw', null) : end('solved', 0);
    if (solved) return end('solved', 1);
  } else if (solved) {
    // 선공이 맞혔다: 후공에게 같은 횟수가 되도록 한 번 더 (B-07)
    return { ...base, turn: 1, lastChance: true };
  }
  const limit = s.maxAttempts;
  if (limit > 0 && attempts[0] >= limit && attempts[1] >= limit) return end('draw', null);
  return { ...base, turn: other(seat) };
}

function guard(s: BullsState, seat: 0 | 1): BullsErrorCode | null {
  if (s.over) return 'INVALID_STATE';
  if (s.turn !== seat) return 'NOT_YOUR_TURN';
  return null;
}

/** B-02, B-03 */
export function guessNumber(s: BullsState, seat: 0 | 1, guess: unknown): BullsResult {
  const g = guard(s, seat);
  if (g) return { ok: false, code: g };
  if (!isValidNumber(guess, s.digits)) return { ok: false, code: 'INVALID_GUESS' };
  const record: GuessRecord = { seat, guess, ...score(s.secrets[other(seat)], guess) };
  return { ok: true, state: advance(s, record), record };
}

/** B-31: 시간 초과로 그 턴을 넘긴다. 시도 1회 (B-09) */
export function skipTurn(s: BullsState, seat: 0 | 1): BullsResult {
  const g = guard(s, seat);
  if (g) return { ok: false, code: g };
  const record: GuessRecord = { seat, guess: null, strikes: 0, balls: 0 };
  return { ok: true, state: advance(s, record), record };
}

/**
 * B-35: 봇 추측. 자기 추측 기록(공개 정보)만 써서, 지금까지의 모든 결과와 맞는 후보 중 하나를 고른다.
 * 비밀 숫자는 보지 않는다
 */
export function botGuess(digits: Digits, own: readonly GuessRecord[], pick: Pick): string {
  const known = own.filter((r): r is GuessRecord & { guess: string } => r.guess !== null);
  const candidates = allNumbers(digits).filter((n) =>
    known.every((r) => {
      const sc = score(n, r.guess);
      return sc.strikes === r.strikes && sc.balls === r.balls;
    }),
  );
  if (candidates.length === 0) return randomNumber(digits, pick);
  return candidates[pick(candidates.length)] as string;
}
