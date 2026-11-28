/**
 * 풍선 터뜨리기 룰 (docs/specs/balloon.md BL-01~BL-06).
 * 순수 함수만 둔다. 터지는 횟수와 첫 차례는 서버가 난수로 정해 넘긴다 (원칙 3, 5).
 */

/** BL-05: 한 차례에 누를 수 있는 최대 횟수 */
export const MAX_PUMPS_PER_TURN = 3;
/** BL-01: 터지는 횟수의 최소 */
export const MIN_THRESHOLD = 5;

/** BL-01: 인원에 따른 터지는 횟수 범위 (양 끝 포함). 2명 5~20, 6명 5~36, 10명 5~52 */
export function thresholdRange(players: number): { readonly min: number; readonly max: number } {
  return { min: MIN_THRESHOLD, max: players * 4 + 12 };
}

export interface BalloonTurn {
  readonly seat: number;
  readonly pumps: number;
  readonly popped: boolean;
}

export interface BalloonState {
  readonly players: number;
  /** 터지는 횟수. 서버 메모리에만 둔다 (BL-20) */
  readonly threshold: number;
  /** 지금까지 분 횟수 */
  readonly total: number;
  readonly turn: number;
  /** 이번 차례에 누른 횟수 */
  readonly turnPumps: number;
  /** 끝난 차례 기록 (진행 중인 차례는 넣지 않는다) */
  readonly turns: readonly BalloonTurn[];
  /** 당첨 좌석. 끝나기 전에는 null */
  readonly loser: number | null;
}

export function createBalloon(players: number, threshold: number, firstSeat: number): BalloonState {
  const range = thresholdRange(players);
  if (players < 2 || firstSeat < 0 || firstSeat >= players) throw new Error('bad seats');
  if (!Number.isInteger(threshold) || threshold < range.min || threshold > range.max)
    throw new Error('threshold out of range');
  return { players, threshold, total: 0, turn: firstSeat, turnPumps: 0, turns: [], loser: null };
}

export type BalloonOutcome =
  | { readonly ok: true; readonly state: BalloonState; readonly popped: boolean; readonly turnEnded: boolean }
  | { readonly ok: false; readonly code: 'NOT_YOUR_TURN' | 'INVALID_MOVE' | 'GAME_OVER' };

function finishTurn(state: BalloonState, popped: boolean): BalloonState {
  const turns = [...state.turns, { seat: state.turn, pumps: state.turnPumps, popped }];
  if (popped) return { ...state, turns, loser: state.turn };
  return { ...state, turns, turn: (state.turn + 1) % state.players, turnPumps: 0 };
}

/** BL-03, BL-05, BL-06: 펌프를 한 번 누른다 */
export function pump(state: BalloonState, seat: number): BalloonOutcome {
  if (state.loser !== null) return { ok: false, code: 'GAME_OVER' };
  if (seat !== state.turn) return { ok: false, code: 'NOT_YOUR_TURN' };
  if (state.turnPumps >= MAX_PUMPS_PER_TURN) return { ok: false, code: 'INVALID_MOVE' };
  const next: BalloonState = { ...state, total: state.total + 1, turnPumps: state.turnPumps + 1 };
  if (next.total >= next.threshold)
    return { ok: true, popped: true, turnEnded: true, state: finishTurn(next, true) };
  // BL-05: 3번째를 누르고 안 터지면 자동으로 넘어간다
  if (next.turnPumps >= MAX_PUMPS_PER_TURN)
    return { ok: true, popped: false, turnEnded: true, state: finishTurn(next, false) };
  return { ok: true, popped: false, turnEnded: false, state: next };
}

/** BL-04: 1번 이상 눌렀으면 넘길 수 있다 */
export function endTurn(state: BalloonState, seat: number): BalloonOutcome {
  if (state.loser !== null) return { ok: false, code: 'GAME_OVER' };
  if (seat !== state.turn) return { ok: false, code: 'NOT_YOUR_TURN' };
  if (state.turnPumps < 1) return { ok: false, code: 'INVALID_MOVE' };
  return { ok: true, popped: false, turnEnded: true, state: finishTurn(state, false) };
}
