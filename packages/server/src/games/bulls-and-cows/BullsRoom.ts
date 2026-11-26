import { bulls } from '@wmg/rules';
import { GameRoom } from '../../framework/game/GameRoom.js';
import type { Rng } from '../../framework/rng.js';
import { runtime } from '../liars-dice/runtime.js';
import { BULLS_SPECTATOR_LIMIT, BullsMatch, type BullsIO } from './BullsMatch.js';
import { toBullsSummary } from './record.js';

/**
 * 숫자야구 Colyseus 방 (docs/specs/bulls-and-cows.md). 연결·세션·전송은 GameRoom(ADR 0003)이 하고,
 * 여기서는 옵션 검증과 판 기록 저장만 정한다.
 */
export class BullsRoom extends GameRoom<BullsMatch, bulls.BullsRoomOptions> {
  override maxClients = bulls.BULLS_PLAYERS + BULLS_SPECTATOR_LIMIT;
  protected readonly gameMessages = ['set_secret', 'random_secret', 'guess'] as const;

  protected parseOptions(rawOptions: unknown): bulls.BullsRoomOptions | null {
    const parsed = bulls.parseBullsOptions(rawOptions);
    return parsed.ok ? parsed.options : null;
  }

  protected createMatch(code: string, options: bulls.BullsRoomOptions, rng: Rng): BullsMatch {
    const io: BullsIO = {
      ...this.io,
      onFinished: (record) => {
        runtime.log('info', 'bulls-and-cows game finished', {
          roomCode: record.roomCode,
          result: record.result,
          attempts: record.players.map((p) => p.attempts),
        });
        // 판 요약만 저장한다 (ADR 0002, bulls-and-cows.md 10장)
        void runtime.recorder.saveSummary(toBullsSummary(record));
      },
    };
    return new BullsMatch(code, options, { io, rng, scheduler: this.scheduler, timing: runtime.timing });
  }
}
