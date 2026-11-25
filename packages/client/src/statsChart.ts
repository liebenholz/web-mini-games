/**
 * 대시보드 그래프 계산 (docs/specs/stats.md). DOM 없이 숫자만 다룬다.
 */

/** 눈금 간격: 1·2·5 × 10^k 중 range/4 이상인 가장 작은 값. 사람 수·판 수라 1보다 작지 않다 */
export function niceStep(max: number): number {
  const raw = Math.max(1, max / 4);
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

/** 0부터 max를 덮는 눈금. 값이 모두 0이면 0~4 */
export function axisTicks(max: number): number[] {
  const step = niceStep(max);
  const top = Math.max(step * 4, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return ticks;
}

/** 'YYYY-MM-DD' → '11/24' */
export function shortDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/** 'YYYY-MM-DD' → '11월 24일 (화)' (날짜만 쓰므로 UTC로 요일을 구한다) */
export function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = '일월화수목금토'[new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).getUTCDay()];
  return `${m}월 ${d}일 (${weekday})`;
}

/** x축에 이름을 붙일 날의 위치. 처음과 끝은 항상, 사이는 고르게 최대 count개 */
export function labelIndexes(length: number, count: number): number[] {
  if (length <= 0) return [];
  if (length <= count) return Array.from({ length }, (_, i) => i);
  const out = new Set<number>();
  for (let i = 0; i < count; i += 1) out.add(Math.round((i * (length - 1)) / (count - 1)));
  return [...out];
}
