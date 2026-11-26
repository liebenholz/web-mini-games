import { gomoku } from '@wmg/rules';
import { GameRoom } from '../../framework/game/GameRoom.js';
import type { Rng } from '../../framework/rng.js';
import { runtime } from '../liars-dice/runtime.js';
import { GOMOKU_SPECTATOR_LIMIT, GomokuMatch, type GomokuIO } from './GomokuMatch.js';
import { toGomokuSummary } from './record.js';

/**
 * 오목 Colyseus 방 (docs/specs/gomoku.md). 연결·세션·전송은 GameRoom(ADR 0003)이 하고,
 * 여기서는 옵션 검증과 판 기록 저장만 정한다.
 */
export class GomokuRoom extends GameRoom<GomokuMatch, gomoku.GomokuRoomOptions> {
  override maxClients = gomoku.GOMOKU_PLAYERS + GOMOKU_SPECTATOR_LIMIT;
  protected readonly gameMessages = ['place'] as const;

  protected parseOptions(rawOptions: unknown): gomoku.GomokuRoomOptions | null {
    const parsed = gomoku.parseGomokuOptions(rawOptions);
    return parsed.ok ? parsed.options : null;
  }

  protected createMatch(code: string, options: gomoku.GomokuRoomOptions, rng: Rng): GomokuMatch {
    const io: GomokuIO = {
      ...this.io,
      onFinished: (record) => {
        runtime.log('info', 'gomoku game finished', {
          roomCode: record.roomCode,
          result: record.result,
          winner: record.winnerColor,
          moves: record.moves.length,
        });
        // 판 요약만 저장한다 (ADR 0002). 저장소는 실패해도 던지지 않고 재시도한다
        void runtime.recorder.saveSummary(toGomokuSummary(record));
      },
    };
    return new GomokuMatch(code, options, { io, rng, scheduler: this.scheduler, timing: runtime.timing });
  }
}
