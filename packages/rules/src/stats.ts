/**
 * 운영 통계 (docs/specs/stats.md). 서버 /stats 응답과 클라이언트 대시보드가 같이 쓰는 타입과 날짜 계산.
 * 시각은 인자로 받는다 (룰 엔진은 시계를 읽지 않는다).
 */

/** ST-03: 고를 수 있는 기간(일). 기본 30일 */
export const STATS_RANGES = [7, 30, 90] as const;
export type StatsRange = (typeof STATS_RANGES)[number];
export const DEFAULT_STATS_RANGE: StatsRange = 30;

export interface DailyStats {
  /** 한국 시간 날짜 'YYYY-MM-DD' */
  readonly date: string;
  /** ST-01: 사이트를 연 게스트 수 */
  readonly visitors: number;
  /** ST-02: 끝난 판에 참여한 사람 게스트 수 (봇 제외) */
  readonly players: number;
  /** 게임별 끝난 판 수. 키는 서버 방 종류(liars_dice, gomoku …) */
  readonly games: Readonly<Record<string, number>>;
  /** CE-08: 그날 받은 클라이언트 오류 수. 키는 kind (docs/specs/client-errors.md) */
  readonly clientErrors: Readonly<Record<string, number>>;
}

/** ST-11: 판 수가 이보다 적은 게임은 비율을 null로 보낸다 */
export const MIN_GAMES_FOR_RATE = 5;

/**
 * ST-10: 기간 안에 끝난 판으로 센 게임별 지표. 비율은 0~1.
 * extra 키: 오목 timeoutRate·avgMoves, 숫자야구 avgAttempts·drawRate, 원카드 bankruptRate·avgTurns,
 * 거짓말쟁이 주사위 autoBidRate, 리버시 avgMoves·passRate·autoMoveRate, 업다운 avgMoves·autoMoveRate·forcedRate, 풍선 avgTurns·autoTurnRate
 */
export interface GameMetrics {
  /** 서버 방 종류 (liars_dice, gomoku …) */
  readonly gameType: string;
  readonly games: number;
  /** 시작부터 끝까지 평균 (분). 판이 없으면 null */
  readonly avgMinutes: number | null;
  /** ST-08: 게임 중 봇이 자리를 이어받은 판의 비율 */
  readonly replacedRate: number | null;
  /** ST-09: 사람이 모두 나가 기록 없이 끝난 판 수 */
  readonly abandoned: number;
  /** 처음부터 봇 자리가 있던 판의 비율 */
  readonly botRate: number | null;
  readonly extra: Readonly<Record<string, number | null>>;
}

export interface StatsResponse {
  readonly range: StatsRange;
  /** 오래된 날부터 오늘까지, 빠진 날 없이 range개 */
  readonly days: readonly DailyStats[];
  /** ST-10: 기간 전체의 게임별 지표 (판 수가 많은 순) */
  readonly perGame: readonly GameMetrics[];
  /** 응답을 만든 시각 (ISO) */
  readonly generatedAt: string;
}

/** 한국은 서머타임이 없어 항상 UTC+9다 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** ST-04: 한국 시간 기준 날짜 */
export function kstDay(epochMs: number): string {
  return new Date(epochMs + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 오늘(한국 시간)을 포함해 거꾸로 range일. 오래된 날부터 */
export function kstDays(range: number, nowMs: number): string[] {
  const out: string[] = [];
  for (let i = range - 1; i >= 0; i -= 1) out.push(kstDay(nowMs - i * DAY_MS));
  return out;
}

export function parseStatsRange(value: unknown): StatsRange {
  const n = Number(value);
  return (STATS_RANGES as readonly number[]).includes(n) ? (n as StatsRange) : DEFAULT_STATS_RANGE;
}

/** 클라이언트 게스트 ID 형식 (identity.ts와 같다) */
export const GUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function totalGames(day: DailyStats): number {
  return Object.values(day.games).reduce((a, b) => a + b, 0);
}
