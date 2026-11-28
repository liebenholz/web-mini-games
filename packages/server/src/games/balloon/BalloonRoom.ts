import { balloon } from '@wmg/rules';
import { GameRoom } from '../../framework/game/GameRoom.js';
import type { Rng } from '../../framework/rng.js';
import { runtime } from '../liars-dice/runtime.js';
import { BALLOON_SPECTATOR_LIMIT, BalloonMatch, type BalloonIO } from './BalloonMatch.js';
import { toBalloonSummary } from './record.js';

/**
 * 풍선 터뜨리기 Colyseus 방 (docs/specs/balloon.md). 연결·세션·전송은 GameRoom(ADR 0003)이 하고,
 * 여기서는 옵션 검증과 판 기록 저장만 정한다.
 */
export class BalloonRoom extends GameRoom<BalloonMatch, balloon.BalloonRoomOptions> {
  override maxClients = balloon.BALLOON_MAX_PLAYERS + BALLOON_SPECTATOR_LIMIT;
  protected readonly gameMessages = ['pump', 'end_turn'] as const;

  protected parseOptions(rawOptions: unknown): balloon.BalloonRoomOptions | null {
    const parsed = balloon.parseBalloonOptions(rawOptions);
    return parsed.ok ? parsed.options : null;
  }

  protected createMatch(code: string, options: balloon.BalloonRoomOptions, rng: Rng): BalloonMatch {
    const io: BalloonIO = {
      ...this.io,
      onFinished: (record) => {
        runtime.log('info', 'balloon game finished', {
          roomCode: record.roomCode,
          turns: record.turns.length,
          threshold: record.threshold,
        });
        // 판 요약만 저장한다 (ADR 0002). 저장소는 실패해도 던지지 않고 재시도한다
        void runtime.recorder.saveSummary(toBalloonSummary(record));
      },
    };
    return new BalloonMatch(code, options, { io, rng, scheduler: this.scheduler, timing: runtime.timing });
  }
}
