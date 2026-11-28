import { treasure } from '@wmg/rules';
import { GameRoom } from '../../framework/game/GameRoom.js';
import type { Rng } from '../../framework/rng.js';
import { runtime } from '../liars-dice/runtime.js';
import { TREASURE_SPECTATOR_LIMIT, TreasureMatch, type TreasureIO } from './TreasureMatch.js';
import { toTreasureSummary } from './record.js';

/**
 * 보물 찾기 Colyseus 방 (docs/specs/treasure.md). 연결·세션·전송은 GameRoom(ADR 0003)이 하고,
 * 여기서는 옵션 검증과 판 기록 저장만 정한다.
 */
export class TreasureRoom extends GameRoom<TreasureMatch, treasure.TreasureRoomOptions> {
  override maxClients = treasure.TREASURE_MAX_PLAYERS + TREASURE_SPECTATOR_LIMIT;
  protected readonly gameMessages = ['pick', 'lock_pick'] as const;

  protected parseOptions(rawOptions: unknown): treasure.TreasureRoomOptions | null {
    const parsed = treasure.parseTreasureOptions(rawOptions);
    return parsed.ok ? parsed.options : null;
  }

  protected createMatch(code: string, options: treasure.TreasureRoomOptions, rng: Rng): TreasureMatch {
    const io: TreasureIO = {
      ...this.io,
      onFinished: (record) => {
        runtime.log('info', 'treasure game finished', {
          roomCode: record.roomCode,
          replays: record.replays,
          tieBreak: record.tieBreak,
        });
        // 판 요약만 저장한다 (ADR 0002). 저장소는 실패해도 던지지 않고 재시도한다
        void runtime.recorder.saveSummary(toTreasureSummary(record));
      },
    };
    return new TreasureMatch(code, options, { io, rng, scheduler: this.scheduler, timing: runtime.timing });
  }
}
