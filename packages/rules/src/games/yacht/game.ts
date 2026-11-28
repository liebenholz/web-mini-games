/**
 * 요트 주사위 룰 (docs/specs/yacht.md YT-01~YT-09, 3장 점수표). 순수 함수만 둔다.
 * 굴린 값은 서버가 `rollDie`로 정해 넘긴다 (원칙 3, 5).
 */

export const DICE_COUNT = 5;
export const MAX_ROLLS = 3;
export const CATEGORY_COUNT = 12;
/** YT-07: 위쪽 여섯 칸의 합이 이 이상이면 보너스 */
export const BONUS_THRESHOLD = 63;
export const BONUS_POINTS = 35;
/** 빈칸 표시 */
export const EMPTY = -1;

export const CATEGORY_NAMES = [
  '1의 눈',
  '2의 눈',
  '3의 눈',
  '4의 눈',
  '5의 눈',
  '6의 눈',
  '초이스',
  '포카드',
  '풀하우스',
  '스몰 스트레이트',
  '라지 스트레이트',
  '요트',
] as const;

/** 칸마다 얻을 수 있는 최대 점수 (YT-12 동점 처리, 봇 판단) */
export const CATEGORY_MAX = [5, 10, 15, 20, 25, 30, 30, 30, 28, 15, 30, 50] as const;

export const CAT_CHOICE = 6;
export const CAT_FOUR = 7;
export const CAT_FULL_HOUSE = 8;
export const CAT_SMALL_STRAIGHT = 9;
export const CAT_LARGE_STRAIGHT = 10;
export const CAT_YACHT = 11;

function counts(dice: readonly number[]): number[] {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d] = (c[d] ?? 0) + 1;
  return c;
}

const sumOf = (dice: readonly number[]) => dice.reduce((a, b) => a + b, 0);

/** YT-06: 주사위 5개로 그 칸에 기록하면 얻는 점수 */
export function scoreCategory(dice: readonly number[], category: number): number {
  const c = counts(dice);
  const values = c.slice(1);
  const has = (run: readonly number[]) => run.every((v) => (c[v] ?? 0) > 0);
  if (category >= 0 && category < 6) return (c[category + 1] ?? 0) * (category + 1);
  switch (category) {
    case CAT_CHOICE:
      return sumOf(dice);
    case CAT_FOUR:
      return Math.max(...values) >= 4 ? sumOf(dice) : 0;
    case CAT_FULL_HOUSE:
      // 같은 눈 5개(요트)는 풀하우스가 아니다
      return values.includes(3) && values.includes(2) ? sumOf(dice) : 0;
    case CAT_SMALL_STRAIGHT:
      return [
        [1, 2, 3, 4],
        [2, 3, 4, 5],
        [3, 4, 5, 6],
      ].some(has)
        ? 15
        : 0;
    case CAT_LARGE_STRAIGHT:
      return [
        [1, 2, 3, 4, 5],
        [2, 3, 4, 5, 6],
      ].some(has)
        ? 30
        : 0;
    case CAT_YACHT:
      return Math.max(...values) === 5 ? 50 : 0;
    default:
      return 0;
  }
}

export type Scores = readonly number[];

export function upperSum(scores: Scores): number {
  let s = 0;
  for (let i = 0; i < 6; i += 1) s += Math.max(0, scores[i] ?? EMPTY);
  return s;
}

/** YT-07 */
export function bonusOf(scores: Scores): number {
  return upperSum(scores) >= BONUS_THRESHOLD ? BONUS_POINTS : 0;
}

/** 현재 점수 + 보너스 */
export function totalOf(scores: Scores): number {
  let s = 0;
  for (const v of scores) s += Math.max(0, v);
  return s + bonusOf(scores);
}

export function emptyScores(): number[] {
  return Array.from({ length: CATEGORY_COUNT }, () => EMPTY);
}

/** YT-08: 순위. 자기보다 합계가 높은 사람 수 + 1 (같은 점수는 같은 순위) */
export function ranks(totals: readonly number[]): number[] {
  return totals.map((t) => 1 + totals.filter((x) => x > t).length);
}

export interface YachtState {
  readonly players: number;
  /** 지금 차례인 좌석 */
  readonly turn: number;
  /** 지금 주사위. 아직 안 굴렸으면 빈 배열 */
  readonly dice: readonly number[];
  /** 이번 차례에 굴린 횟수 (0~3) */
  readonly rollNo: number;
  /** 사람마다 12칸 (빈칸 -1) */
  readonly scores: readonly (readonly number[])[];
  /** 끝난 차례 수 */
  readonly turnsDone: number;
}

export function createYacht(players: number, firstSeat: number): YachtState {
  if (players < 2 || firstSeat < 0 || firstSeat >= players) throw new Error('bad seats');
  return {
    players,
    turn: firstSeat,
    dice: [],
    rollNo: 0,
    scores: Array.from({ length: players }, () => emptyScores()),
    turnsDone: 0,
  };
}

export const isFinished = (s: YachtState): boolean => s.turnsDone >= s.players * CATEGORY_COUNT;

/** 이번 굴림에서 새로 굴릴 주사위 개수 (남기지 않은 것) */
export function freshCount(keep: readonly boolean[]): number {
  return keep.filter((k) => !k).length;
}

export type YachtError = 'NOT_YOUR_TURN' | 'INVALID_MOVE' | 'GAME_OVER';
export type YachtOutcome =
  { readonly ok: true; readonly state: YachtState } | { readonly ok: false; readonly code: YachtError };

/**
 * YT-02, YT-04: 굴린다. keep은 남길 주사위(5개). 첫 굴림은 모두 false여야 한다.
 * fresh는 남기지 않은 주사위 개수만큼의 새 값(1~6)을 앞에서부터 채운다
 */
export function rollDice(
  state: YachtState,
  seat: number,
  keep: unknown,
  fresh: readonly number[],
): YachtOutcome {
  if (isFinished(state)) return { ok: false, code: 'GAME_OVER' };
  if (seat !== state.turn) return { ok: false, code: 'NOT_YOUR_TURN' };
  if (!Array.isArray(keep) || keep.length !== DICE_COUNT || keep.some((k) => typeof k !== 'boolean'))
    return { ok: false, code: 'INVALID_MOVE' };
  const k = keep as boolean[];
  if (state.rollNo >= MAX_ROLLS) return { ok: false, code: 'INVALID_MOVE' };
  if (state.rollNo === 0 && k.some(Boolean)) return { ok: false, code: 'INVALID_MOVE' };
  if (state.rollNo > 0 && k.every(Boolean)) return { ok: false, code: 'INVALID_MOVE' };
  const need = freshCount(k);
  if (fresh.length !== need || fresh.some((v) => !Number.isInteger(v) || v < 1 || v > 6))
    return { ok: false, code: 'INVALID_MOVE' };
  let next = 0;
  const dice = Array.from({ length: DICE_COUNT }, (_, i) =>
    state.rollNo > 0 && k[i] ? (state.dice[i] ?? 1) : (fresh[next++] ?? 1),
  );
  return { ok: true, state: { ...state, dice, rollNo: state.rollNo + 1 } };
}

/** YT-03, YT-05: 빈칸 하나에 기록하고 차례를 넘긴다 */
export function scoreTurn(
  state: YachtState,
  seat: number,
  category: unknown,
): YachtOutcome & { readonly points?: number } {
  if (isFinished(state)) return { ok: false, code: 'GAME_OVER' };
  if (seat !== state.turn) return { ok: false, code: 'NOT_YOUR_TURN' };
  if (state.rollNo < 1) return { ok: false, code: 'INVALID_MOVE' };
  if (
    typeof category !== 'number' ||
    !Number.isInteger(category) ||
    category < 0 ||
    category >= CATEGORY_COUNT
  )
    return { ok: false, code: 'INVALID_MOVE' };
  const mine = state.scores[seat] ?? [];
  if ((mine[category] ?? EMPTY) !== EMPTY) return { ok: false, code: 'INVALID_MOVE' };
  const points = scoreCategory(state.dice, category);
  const scores = state.scores.map((row, i) =>
    i === seat ? row.map((v, c) => (c === category ? points : v)) : row,
  );
  return {
    ok: true,
    points,
    state: {
      ...state,
      scores,
      dice: state.dice,
      rollNo: 0,
      turn: (state.turn + 1) % state.players,
      turnsDone: state.turnsDone + 1,
    },
  };
}

/**
 * YT-12: 시간 초과 때 대신 기록할 칸. 점수가 가장 높은 빈칸, 같으면 최대 점수가 낮은 칸(아낄 칸을 남긴다), 그래도 같으면 번호 순
 */
export function autoCategory(dice: readonly number[], scores: Scores): number {
  let best = -1;
  let bestPts = -1;
  for (let c = 0; c < CATEGORY_COUNT; c += 1) {
    if ((scores[c] ?? EMPTY) !== EMPTY) continue;
    const p = scoreCategory(dice, c);
    if (p > bestPts || (p === bestPts && best >= 0 && (CATEGORY_MAX[c] ?? 0) < (CATEGORY_MAX[best] ?? 0))) {
      best = c;
      bestPts = p;
    }
  }
  return best;
}
