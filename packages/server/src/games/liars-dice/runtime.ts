import { cryptoRng, type Rng } from '../../framework/rng.js';
import { noopRecorder, type GameRecorder } from '../../persistence/types.js';
import { DEFAULT_TIMING, type AloneWithBotsPolicy, type Timing } from './LiarsDiceMatch.js';

/** 서버 설정에서 방으로 넘기는 의존성. 클라이언트가 바꿀 수 없다. */
export interface LiarsDiceRuntime {
  recorder: GameRecorder;
  /** 방마다 새로 만든다. 테스트에서만 시드 난수를 넣는다 (S-04) */
  createRng: () => Rng;
  timing: Timing;
  /** S-08: 재접속 대기 시간(초) */
  reconnectSeconds: number;
  alonePolicy: AloneWithBotsPolicy;
  /** graceful shutdown 중에는 새 방을 만들지 않는다 */
  draining: boolean;
  log: (level: 'info' | 'warn' | 'error', message: string, extra?: Record<string, unknown>) => void;
}

export const runtime: LiarsDiceRuntime = {
  recorder: noopRecorder,
  createRng: () => cryptoRng,
  timing: DEFAULT_TIMING,
  reconnectSeconds: 60,
  alonePolicy: 'continue',
  draining: false,
  log: (level, message, extra) => {
    const line = JSON.stringify({ level, message, ...extra, time: new Date().toISOString() });
    if (level === 'error') console.error(line);
    else console.log(line);
  },
};

export function configureLiarsDice(patch: Partial<LiarsDiceRuntime>): void {
  Object.assign(runtime, patch);
}

/** 진행 중인 방 목록 (graceful shutdown 판단용) */
export const activeRooms = new Set<{ readonly inProgress: boolean }>();
