import {
  CAT_CHOICE,
  CAT_FOUR,
  CAT_FULL_HOUSE,
  CAT_LARGE_STRAIGHT,
  CAT_SMALL_STRAIGHT,
  CAT_YACHT,
  CATEGORY_COUNT,
  DICE_COUNT,
  EMPTY,
  scoreCategory,
  type Scores,
} from './game.js';

/** 칸마다 평균적으로 기대하는 점수. 봇은 "점수 − 기대 점수"가 큰 칸에 기록한다 (YT-13) */
const EXPECTED = [2.1, 5.3, 8.6, 12.2, 15.7, 19.2, 22, 13, 13, 9, 7, 4] as const;

/** YT-13: 기록할 칸. 점수 − 기대 점수가 가장 큰 빈칸 (같으면 앞 번호) */
export function yachtBotCategory(dice: readonly number[], scores: Scores): number {
  let best = -1;
  let bestGain = -Infinity;
  for (let c = 0; c < CATEGORY_COUNT; c += 1) {
    if ((scores[c] ?? EMPTY) !== EMPTY) continue;
    const gain = scoreCategory(dice, c) - (EXPECTED[c] ?? 0);
    if (gain > bestGain) {
      best = c;
      bestGain = gain;
    }
  }
  return best;
}

const isOpen = (scores: Scores, c: number) => (scores[c] ?? EMPTY) === EMPTY;

/**
 * YT-13: 다음 굴림에서 남길 주사위. null이면 더 굴리지 않고 바로 기록한다.
 * - 요트, 라지 스트레이트, 풀하우스(빈칸일 때)처럼 이미 좋은 모양이면 멈춘다
 * - 스트레이트에 가까우면(이어지는 눈 4개) 그 눈을 남기고, 아니면 가장 많이 나온 눈을 남긴다
 */
export function yachtBotKeep(dice: readonly number[], scores: Scores): boolean[] | null {
  if (dice.length !== DICE_COUNT) return null;
  if (scoreCategory(dice, CAT_YACHT) > 0 && isOpen(scores, CAT_YACHT)) return null;
  if (scoreCategory(dice, CAT_LARGE_STRAIGHT) > 0 && isOpen(scores, CAT_LARGE_STRAIGHT)) return null;
  if (scoreCategory(dice, CAT_FULL_HOUSE) > 0 && isOpen(scores, CAT_FULL_HOUSE)) return null;
  const present = new Set(dice);
  const wantStraight = isOpen(scores, CAT_LARGE_STRAIGHT) || isOpen(scores, CAT_SMALL_STRAIGHT);
  if (wantStraight) {
    for (const run of [
      [2, 3, 4, 5],
      [1, 2, 3, 4],
      [3, 4, 5, 6],
    ]) {
      if (
        run.every((v) => present.has(v)) &&
        (isOpen(scores, CAT_SMALL_STRAIGHT) || isOpen(scores, CAT_LARGE_STRAIGHT))
      ) {
        const used = new Set<number>();
        return dice.map((d) => {
          if (run.includes(d) && !used.has(d)) {
            used.add(d);
            return true;
          }
          return false;
        });
      }
    }
  }
  const cnt = new Map<number, number>();
  for (const d of dice) cnt.set(d, (cnt.get(d) ?? 0) + 1);
  // 가장 많이 나온 눈 (같으면 큰 눈). 포카드·초이스를 노릴 때는 큰 눈이 좋다
  let face = 1;
  let most = 0;
  for (const [v, n] of cnt)
    if (n > most || (n === most && v > face)) {
      face = v;
      most = n;
    }
  // 이미 4개 이상이고 포카드가 빈칸이면 멈춘다
  if (most >= 4 && isOpen(scores, CAT_FOUR) && scoreCategory(dice, CAT_FOUR) > 0) return null;
  // 초이스만 남았고 합이 높으면 멈춘다
  const open = Array.from({ length: CATEGORY_COUNT }, (_, c) => c).filter((c) => isOpen(scores, c));
  if (open.length === 1 && open[0] === CAT_CHOICE && dice.reduce((a, b) => a + b, 0) >= 22) return null;
  const keep = dice.map((d) => d === face);
  // 모두 남기면 굴릴 수 없다 (YT-04): 더 굴릴 게 없으니 바로 기록한다
  return keep.every(Boolean) ? null : keep;
}
