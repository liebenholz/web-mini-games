import type { TablePlayer, TableState } from './types.js';

export const MIN_STARTING_DICE = 3;
export const MAX_STARTING_DICE = 5;

/** R-01: 각 좌석이 같은 수의 주사위로 시작한다. 좌석 번호는 오름차순으로 정렬한다 (R-02). */
export function createTable(seats: readonly number[], startingDice: number): TableState {
  if (
    !Number.isInteger(startingDice) ||
    startingDice < MIN_STARTING_DICE ||
    startingDice > MAX_STARTING_DICE
  ) {
    throw new RangeError(`startingDice must be ${MIN_STARTING_DICE}..${MAX_STARTING_DICE}`);
  }
  if (new Set(seats).size !== seats.length) throw new RangeError('duplicate seat');
  const players = [...seats]
    .sort((a, b) => a - b)
    .map((seat): TablePlayer => ({ seat, diceCount: startingDice, eliminationOrder: null }));
  return { players };
}

/** R-12 */
export function isEliminated(player: TablePlayer): boolean {
  return player.diceCount <= 0;
}

/** 생존 좌석을 오름차순으로 돌려준다. */
export function aliveSeats(state: TableState): number[] {
  return state.players.filter((p) => !isEliminated(p)).map((p) => p.seat);
}

/** 테이블 위 주사위 총 개수 (R-05의 개수 상한) */
export function totalDice(state: TableState): number {
  return state.players.reduce((sum, p) => sum + Math.max(0, p.diceCount), 0);
}

export function findPlayer(state: TableState, seat: number): TablePlayer | undefined {
  return state.players.find((p) => p.seat === seat);
}

/** R-10, R-12: 좌석의 주사위를 1개 줄이고, 0개가 되면 탈락 순서를 기록한다. 원본은 바꾸지 않는다. */
export function applyLoss(state: TableState, seat: number): TableState {
  const target = findPlayer(state, seat);
  if (!target) throw new RangeError(`unknown seat ${seat}`);
  if (isEliminated(target)) throw new RangeError(`seat ${seat} is already eliminated`);
  const eliminatedSoFar = state.players.filter((p) => p.eliminationOrder !== null).length;
  return {
    players: state.players.map((p) => {
      if (p.seat !== seat) return p;
      const diceCount = p.diceCount - 1;
      return { seat: p.seat, diceCount, eliminationOrder: diceCount === 0 ? eliminatedSoFar + 1 : null };
    }),
  };
}

/** 생존자가 1명 이하이면 게임이 끝난다. */
export function isGameOver(state: TableState): boolean {
  return aliveSeats(state).length <= 1;
}

/**
 * R-02: 시계 방향(좌석 번호 오름차순, 끝에서 처음으로 순환) 다음 생존 좌석.
 * `from`이 생존 좌석이 아니어도(탈락 직후) 그 자리 다음부터 찾는다.
 */
export function nextTurnSeat(from: number, alive: readonly number[]): number {
  if (alive.length === 0) throw new RangeError('no alive seats');
  const sorted = [...alive].sort((a, b) => a - b);
  return sorted.find((s) => s > from) ?? (sorted[0] as number);
}

/** R-04: 다음 라운드 선은 주사위를 잃은 사람. 탈락했으면 시계 방향 다음 생존자. */
export function nextStarter(loserSeat: number, alive: readonly number[]): number {
  if (alive.includes(loserSeat)) return loserSeat;
  return nextTurnSeat(loserSeat, alive);
}

export interface RankEntry {
  readonly seat: number;
  /** 확정되지 않았으면(게임 진행 중 생존자) null */
  readonly rank: number | null;
}

/**
 * R-13: 마지막 생존자가 1위, 나머지는 나중에 탈락할수록 높은 순위.
 * N명 게임에서 k번째 탈락자의 순위 = N - k + 1.
 */
export function ranking(state: TableState): RankEntry[] {
  const n = state.players.length;
  const over = isGameOver(state);
  return state.players
    .map((p): RankEntry => {
      if (p.eliminationOrder !== null) return { seat: p.seat, rank: n - p.eliminationOrder + 1 };
      return { seat: p.seat, rank: over ? 1 : null };
    })
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.seat - b.seat);
}
