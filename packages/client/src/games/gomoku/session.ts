import type { Room } from '@colyseus/sdk';
import { gomoku } from '@wmg/rules';
import { connectSession, RoomSession, type BaseSnapshot, type PlayerNotice } from '../roomSession.js';

export interface GomokuPlayerView {
  readonly id: string;
  readonly nickname: string;
  readonly isBot: boolean;
  readonly isHost: boolean;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly spectator: boolean;
  readonly color: '' | gomoku.GomokuColor;
  readonly replaced: boolean;
  /** G-15: 거절당한 뒤 전체 돌이 이 개수가 될 때까지 제안할 수 없다 */
  readonly drawBlockedUntil: number;
}

export interface GomokuOptionsView {
  readonly blackPolicy: gomoku.BlackPolicy;
  readonly forbidDoubleThree: boolean;
  readonly forbidDoubleFour: boolean;
  readonly forbidOverline: boolean;
  readonly turnSeconds: 15 | 30 | 60;
  readonly fillWithBots: boolean;
  readonly isPrivate: boolean;
}

export interface GomokuView {
  readonly phase: gomoku.GomokuPhase;
  readonly roomCode: string;
  readonly hostId: string;
  readonly options: GomokuOptionsView;
  readonly players: readonly GomokuPlayerView[];
  readonly board: readonly gomoku.Cell[];
  readonly moveCount: number;
  readonly lastMove: number;
  readonly currentTurn: string;
  readonly turnId: string;
  readonly deadline: number;
  readonly phaseEndsAt: number;
  readonly result: '' | gomoku.GomokuResult;
  readonly winnerId: string;
  readonly winLine: readonly number[];
  /** G-16: 무승부를 제안한 사람과 응답 마감 시각 */
  readonly drawOfferBy: string;
  readonly drawOfferDeadline: number;
}

/** 상대에게 띄우는 알림 (G-37) */
export type GomokuNotice = PlayerNotice;

/** 무승부 제안이 끝났다는 알림 (G-16, G-38) */
export interface DrawNote {
  readonly by: string;
  readonly reason: gomoku.DrawDeclineReason;
  readonly at: number;
}

export interface GomokuSnapshot extends BaseSnapshot<GomokuView> {
  readonly drawNote: DrawNote | null;
}

interface SchemaLike {
  toJSON(): unknown;
}

function readView(state: SchemaLike): GomokuView {
  const raw = state.toJSON() as Omit<GomokuView, 'players'> & { players?: Record<string, GomokuPlayerView> };
  return {
    ...raw,
    players: Object.values(raw.players ?? {}),
    board: raw.board ?? [],
    winLine: raw.winLine ?? [],
  };
}

/** 오목 방 하나와의 연결 (docs/specs/gomoku.md 6장). 연결 공통 부분은 RoomSession (ADR 0003) */
export class GomokuSession extends RoomSession<GomokuView, GomokuSnapshot> {
  private constructor(room: Room) {
    super(room, (state) => readView(state as SchemaLike), { drawNote: null });
  }

  static create(nickname: string, options: Partial<gomoku.GomokuRoomOptions> = {}): Promise<GomokuSession> {
    return connectSession(
      gomoku.GOMOKU_ROOM_TYPE,
      nickname,
      { kind: 'create', options },
      (r) => new GomokuSession(r),
    );
  }

  static join(code: string, nickname: string): Promise<GomokuSession> {
    return connectSession(
      gomoku.GOMOKU_ROOM_TYPE,
      nickname,
      { kind: 'join', code },
      (r) => new GomokuSession(r),
    );
  }

  static quickMatch(nickname: string): Promise<GomokuSession> {
    return connectSession(gomoku.GOMOKU_ROOM_TYPE, nickname, { kind: 'quick' }, (r) => new GomokuSession(r));
  }

  send<T extends gomoku.GomokuClientMessageType>(type: T, payload: gomoku.GomokuClientMessages[T]): void {
    this.room.send(type, payload);
  }

  protected onGameMessage(type: string, p: Record<string, unknown>): void {
    if (type !== 'draw_declined') return;
    this.update({
      drawNote: { by: String(p.playerId), reason: p.reason as gomoku.DrawDeclineReason, at: Date.now() },
    });
  }
}
