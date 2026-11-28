import { yacht } from '@wmg/rules';
import { GameRoom } from '../../framework/game/GameRoom.js';
import type { Rng } from '../../framework/rng.js';
import { runtime } from '../liars-dice/runtime.js';
import { YACHT_SPECTATOR_LIMIT, YachtMatch, type YachtIO } from './YachtMatch.js';
import { toYachtSummary } from './record.js';

/**
 * 요트 주사위 Colyseus 방 (docs/specs/yacht.md). 연결·세션·전송은 GameRoom(ADR 0003)이 하고,
 * 여기서는 옵션 검증과 판 기록 저장만 정한다.
 */
export class YachtRoom extends GameRoom<YachtMatch, yacht.YachtRoomOptions> {
  override maxClients = yacht.YACHT_MAX_PLAYERS + YACHT_SPECTATOR_LIMIT;
  protected readonly gameMessages = ['roll', 'score'] as const;

  protected parseOptions(rawOptions: unknown): yacht.YachtRoomOptions | null {
    const parsed = yacht.parseYachtOptions(rawOptions);
    return parsed.ok ? parsed.options : null;
  }

  protected createMatch(code: string, options: yacht.YachtRoomOptions, rng: Rng): YachtMatch {
    const io: YachtIO = {
      ...this.io,
      onFinished: (record) => {
        runtime.log('info', 'yacht game finished', { roomCode: record.roomCode, turns: record.turns });
        // 판 요약만 저장한다 (ADR 0002). 저장소는 실패해도 던지지 않고 재시도한다
        void runtime.recorder.saveSummary(toYachtSummary(record));
      },
    };
    return new YachtMatch(code, options, { io, rng, scheduler: this.scheduler, timing: runtime.timing });
  }
}
