/**
 * 업다운 숫자폭탄 룰 (docs/specs/updown-bomb.md UD-01~UD-07).
 * 순수 함수만 둔다. 폭탄 숫자와 첫 차례는 서버가 난수로 정해 넘긴다 (원칙 3, 5).
 */

export type CallResult = 'up' | 'down' | 'bomb';

export interface UpdownCall {
  readonly seat: number;
  readonly value: number;
  readonly result: CallResult;
}

export interface UpdownState {
  /** 지금 범위 (양 끝 포함) */
  readonly low: number;
  readonly high: number;
  /** 폭탄 숫자. 서버 메모리에만 둔다 (UD-20) */
  readonly bomb: number;
  readonly players: number;
  /** 지금 차례인 좌석 */
  readonly turn: number;
  readonly calls: readonly UpdownCall[];
  /** 당첨 좌석. 끝나기 전에는 null */
  readonly loser: number | null;
  /** UD-07: 남은 숫자가 폭탄뿐이라 끝났다 */
  readonly forced: boolean;
}

export function createUpdown(
  range: { readonly low: number; readonly high: number },
  players: number,
  bomb: number,
  firstSeat: number,
): UpdownState {
  if (!(range.low < range.high)) throw new Error('range must have at least two numbers');
  if (bomb < range.low || bomb > range.high) throw new Error('bomb out of range');
  if (players < 2 || firstSeat < 0 || firstSeat >= players) throw new Error('bad seats');
  return {
    low: range.low,
    high: range.high,
    bomb,
    players,
    turn: firstSeat,
    calls: [],
    loser: null,
    forced: false,
  };
}

export function remaining(state: Pick<UpdownState, 'low' | 'high'>): number {
  return state.high - state.low + 1;
}

/** UD-03: 지금 범위 안의 정수인가 */
export function isInRange(state: Pick<UpdownState, 'low' | 'high'>, value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= state.low && value <= state.high;
}

export type CallOutcome =
  | { readonly ok: true; readonly state: UpdownState; readonly result: CallResult }
  | { readonly ok: false; readonly code: 'OUT_OF_RANGE' | 'NOT_YOUR_TURN' | 'GAME_OVER' };

/** UD-03~UD-07: seat이 value를 말한다 */
export function callNumber(state: UpdownState, seat: number, value: unknown): CallOutcome {
  if (state.loser !== null) return { ok: false, code: 'GAME_OVER' };
  if (seat !== state.turn) return { ok: false, code: 'NOT_YOUR_TURN' };
  if (!isInRange(state, value)) return { ok: false, code: 'OUT_OF_RANGE' };
  const result: CallResult = value === state.bomb ? 'bomb' : value < state.bomb ? 'up' : 'down';
  const calls = [...state.calls, { seat, value, result }];
  if (result === 'bomb') return { ok: true, result, state: { ...state, calls, loser: seat } };
  const low = result === 'up' ? value + 1 : state.low;
  const high = result === 'down' ? value - 1 : state.high;
  const next = (seat + 1) % state.players;
  // UD-07: 남은 숫자가 하나면 그것이 폭탄이다. 다음 차례인 사람이 바로 당첨
  if (low === high)
    return { ok: true, result, state: { ...state, low, high, calls, turn: next, loser: next, forced: true } };
  return { ok: true, result, state: { ...state, low, high, calls, turn: next } };
}
