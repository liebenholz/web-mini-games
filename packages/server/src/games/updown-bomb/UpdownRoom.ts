import { updown } from '@wmg/rules';
import { GameRoom } from '../../framework/game/GameRoom.js';
import type { Rng } from '../../framework/rng.js';
import { runtime } from '../liars-dice/runtime.js';
import { UPDOWN_SPECTATOR_LIMIT, UpdownMatch, type UpdownIO } from './UpdownMatch.js';
import { toUpdownSummary } from './record.js';

/**
 * 업다운 숫자폭탄 Colyseus 방 (docs/specs/updown-bomb.md). 연결·세션·전송은 GameRoom(ADR 0003)이 하고,
 * 여기서는 옵션 검증과 판 기록 저장만 정한다.
 */
export class UpdownRoom extends GameRoom<UpdownMatch, updown.UpdownRoomOptions> {
  override maxClients = updown.UPDOWN_MAX_PLAYERS + UPDOWN_SPECTATOR_LIMIT;
  protected readonly gameMessages = ['call_number'] as const;

  protected parseOptions(rawOptions: unknown): updown.UpdownRoomOptions | null {
    const parsed = updown.parseUpdownOptions(rawOptions);
    return parsed.ok ? parsed.options : null;
  }

  protected createMatch(code: string, options: updown.UpdownRoomOptions, rng: Rng): UpdownMatch {
    const io: UpdownIO = {
      ...this.io,
      onFinished: (record) => {
        runtime.log('info', 'updown game finished', {
          roomCode: record.roomCode,
          moves: record.calls.length,
          forced: record.forced,
        });
        // 판 요약만 저장한다 (ADR 0002). 저장소는 실패해도 던지지 않고 재시도한다
        void runtime.recorder.saveSummary(toUpdownSummary(record));
      },
    };
    return new UpdownMatch(code, options, { io, rng, scheduler: this.scheduler, timing: runtime.timing });
  }
}
