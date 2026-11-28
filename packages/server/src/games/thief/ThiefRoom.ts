import { thief } from '@wmg/rules';
import { GameRoom } from '../../framework/game/GameRoom.js';
import type { Rng } from '../../framework/rng.js';
import { runtime } from '../liars-dice/runtime.js';
import { THIEF_SPECTATOR_LIMIT, ThiefMatch, type ThiefIO } from './ThiefMatch.js';
import { toThiefSummary } from './record.js';

/**
 * 도둑잡기 Colyseus 방 (docs/specs/thief.md). 연결·세션·전송은 GameRoom(ADR 0003)이 하고,
 * 여기서는 옵션 검증과 판 기록 저장만 정한다.
 */
export class ThiefRoom extends GameRoom<ThiefMatch, thief.ThiefRoomOptions> {
  override maxClients = thief.THIEF_MAX_PLAYERS + THIEF_SPECTATOR_LIMIT;
  protected readonly gameMessages = ['draw'] as const;

  protected parseOptions(rawOptions: unknown): thief.ThiefRoomOptions | null {
    const parsed = thief.parseThiefOptions(rawOptions);
    return parsed.ok ? parsed.options : null;
  }

  protected createMatch(code: string, options: thief.ThiefRoomOptions, rng: Rng): ThiefMatch {
    const io: ThiefIO = {
      ...this.io,
      onFinished: (record) => {
        runtime.log('info', 'thief game finished', { roomCode: record.roomCode, draws: record.draws });
        // 판 요약만 저장한다 (ADR 0002). 저장소는 실패해도 던지지 않고 재시도한다
        void runtime.recorder.saveSummary(toThiefSummary(record));
      },
    };
    return new ThiefMatch(code, options, { io, rng, scheduler: this.scheduler, timing: runtime.timing });
  }
}
