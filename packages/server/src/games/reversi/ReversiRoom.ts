import { reversi } from '@wmg/rules';
import { GameRoom } from '../../framework/game/GameRoom.js';
import type { Rng } from '../../framework/rng.js';
import { runtime } from '../liars-dice/runtime.js';
import { REVERSI_SPECTATOR_LIMIT, ReversiMatch, type ReversiIO } from './ReversiMatch.js';
import { toReversiSummary } from './record.js';

/**
 * 리버시 Colyseus 방 (docs/specs/reversi.md). 연결·세션·전송은 GameRoom(ADR 0003)이 하고,
 * 여기서는 옵션 검증과 판 기록 저장만 정한다.
 */
export class ReversiRoom extends GameRoom<ReversiMatch, reversi.ReversiRoomOptions> {
  override maxClients = reversi.REVERSI_PLAYERS + REVERSI_SPECTATOR_LIMIT;
  protected readonly gameMessages = ['place'] as const;

  protected parseOptions(rawOptions: unknown): reversi.ReversiRoomOptions | null {
    const parsed = reversi.parseReversiOptions(rawOptions);
    return parsed.ok ? parsed.options : null;
  }

  protected createMatch(code: string, options: reversi.ReversiRoomOptions, rng: Rng): ReversiMatch {
    const io: ReversiIO = {
      ...this.io,
      onFinished: (record) => {
        runtime.log('info', 'reversi game finished', {
          roomCode: record.roomCode,
          result: record.result,
          winner: record.winnerColor,
          moves: record.moves.length,
          black: record.black,
          white: record.white,
        });
        // 판 요약만 저장한다 (ADR 0002). 저장소는 실패해도 던지지 않고 재시도한다
        void runtime.recorder.saveSummary(toReversiSummary(record));
      },
    };
    return new ReversiMatch(code, options, { io, rng, scheduler: this.scheduler, timing: runtime.timing });
  }
}
