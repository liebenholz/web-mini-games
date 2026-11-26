import { MAX_PLAYERS, parseRoomOptions, type ErrorCode, type RoomOptions } from '@wmg/rules';
import { GameRoom } from '../../framework/game/GameRoom.js';
import type { Rng } from '../../framework/rng.js';
import { LiarsDiceMatch, SPECTATOR_LIMIT, type MatchIO } from './LiarsDiceMatch.js';
import { runtime } from './runtime.js';

/**
 * 거짓말쟁이 주사위 Colyseus 방. 연결·세션·전송은 GameRoom(ADR 0003)이 하고,
 * 여기서는 옵션 검증, 판 기록 저장, 메시지 순서 정보(명세 6장)만 정한다.
 * - 공유 상태는 공개 정보뿐이다 (S-01). 주사위는 sendTo로 본인에게만 보낸다.
 * - 봇은 방 안에서 함수 호출로 움직인다 (원칙 9).
 */
export class LiarsDiceRoom extends GameRoom<LiarsDiceMatch, RoomOptions> {
  override maxClients = MAX_PLAYERS + SPECTATOR_LIMIT;
  protected readonly gameMessages = ['bid', 'call_liar'] as const;

  protected parseOptions(rawOptions: unknown): RoomOptions | null {
    const parsed = parseRoomOptions(rawOptions);
    return parsed.ok ? parsed.options : null;
  }

  protected createMatch(code: string, options: RoomOptions, rng: Rng): LiarsDiceMatch {
    const io: MatchIO = {
      ...this.io,
      onRecord: (record) => {
        // 원칙 8, M3: 판이 끝날 때 한 번 저장. 실패해도 게임 진행은 막지 않는다
        runtime.recorder.save(record).catch((error: unknown) => {
          runtime.log('error', 'game record save failed', { gameId: record.gameId, error: String(error) });
        });
      },
    };
    return new LiarsDiceMatch(code, options, {
      io,
      rng,
      scheduler: this.scheduler,
      timing: runtime.timing,
      alonePolicy: runtime.alonePolicy,
    });
  }

  /** 명세 6장: welcome과 error에도 순서 정보를 붙인다 */
  protected override welcomePayload(playerId: string, role: 'player' | 'spectator'): Record<string, unknown> {
    return { playerId, role, ...this.match.envelope() };
  }

  protected override errorPayload(code: ErrorCode, message: string): Record<string, unknown> {
    return { code, message, ...this.match.envelope() };
  }
}
