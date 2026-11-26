import { oneCard } from '@wmg/rules';
import { GameRoom } from '../../framework/game/GameRoom.js';
import type { Rng } from '../../framework/rng.js';
import { runtime } from '../liars-dice/runtime.js';
import { ONE_CARD_SPECTATOR_LIMIT, OneCardMatch, type OneCardIO } from './OneCardMatch.js';
import { toOneCardSummary } from './record.js';

/**
 * 원카드 Colyseus 방 (docs/specs/one-card.md). 연결·세션·전송은 GameRoom(ADR 0003)이 하고,
 * 여기서는 옵션 검증과 판 기록 저장만 정한다.
 */
export class OneCardRoom extends GameRoom<OneCardMatch, oneCard.OneCardRoomOptions> {
  // 정원은 최대 6명 (방 옵션 maxPlayers)
  override maxClients = 6 + ONE_CARD_SPECTATOR_LIMIT;
  protected readonly gameMessages = ['play', 'draw', 'pass', 'call_one_card'] as const;

  protected parseOptions(rawOptions: unknown): oneCard.OneCardRoomOptions | null {
    const parsed = oneCard.parseOneCardOptions(rawOptions);
    return parsed.ok ? parsed.options : null;
  }

  protected createMatch(code: string, options: oneCard.OneCardRoomOptions, rng: Rng): OneCardMatch {
    const io: OneCardIO = {
      ...this.io,
      onFinished: (record) => {
        runtime.log('info', 'one-card game finished', {
          roomCode: record.roomCode,
          players: record.players.length,
          turns: record.turnCount,
        });
        // 판 요약만 저장한다 (ADR 0002, one-card.md 13장)
        void runtime.recorder.saveSummary(toOneCardSummary(record));
      },
    };
    return new OneCardMatch(code, options, { io, rng, scheduler: this.scheduler, timing: runtime.timing });
  }
}
