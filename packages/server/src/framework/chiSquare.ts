/**
 * 카이제곱 적합도 검정 (TC-15). 관측 개수가 모두 같은 확률이라는 가설을 검정한다.
 * p값은 자유도 df인 카이제곱 분포의 위쪽 꼬리 확률 = Q(df/2, x/2) (정규화한 위쪽 불완전 감마 함수).
 */
export interface ChiSquareResult {
  readonly statistic: number;
  readonly df: number;
  readonly pValue: number;
}

/** Lanczos 근사 (g = 7). x > 0 */
function logGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = c[0] as number;
  const t = z + 7.5;
  for (let i = 1; i < 9; i += 1) a += (c[i] as number) / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** 정규화한 위쪽 불완전 감마 함수 Q(a, x) */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  const front = Math.exp(-x + a * Math.log(x) - logGamma(a));
  if (x < a + 1) {
    // 급수로 P를 구하고 1에서 뺀다
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 1000; n += 1) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
    }
    return Math.max(0, 1 - sum * front);
  }
  // 연분수 (수정 Lentz)
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return Math.min(1, front * h);
}

/** 모든 칸의 기대 개수가 같다는 가설. 칸 수가 k면 자유도는 k - 1 */
export function chiSquareUniform(counts: readonly number[]): ChiSquareResult {
  const total = counts.reduce((a, b) => a + b, 0);
  const k = counts.length;
  if (k < 2 || total === 0) throw new Error('need at least 2 bins and 1 observation');
  const expected = total / k;
  const statistic = counts.reduce((s, o) => s + (o - expected) ** 2 / expected, 0);
  const df = k - 1;
  return { statistic, df, pValue: gammaQ(df / 2, statistic / 2) };
}
