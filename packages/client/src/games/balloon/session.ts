import type { Room } from '@colyseus/sdk';
import { balloon } from '@wmg/rules';
import { connectSession, RoomSession, type BaseSnapshot } from '../roomSession.js';

export interface BalloonPlayerView {
  readonly id: string;
  readonly nickname: string;
  readonly isBot: boolean;
  readonly isHost: boolean;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly spectator: boolean;
  readonly seat: number;
  readonly replaced: boolean;
  readonly autopilot: boolean;
}

export interface BalloonOptionsView {
  readonly maxPlayers: number;
  readonly turnSeconds: balloon.BalloonTurnSeconds;
  readonly fillWithBots: boolean;
  readonly isPrivate: boolean;
}

export interface BalloonTurnView {
  readonly playerId: string;
  readonly pumps: number;
  readonly isAuto: boolean;
  readonly popped: boolean;
}

export interface BalloonView {
  readonly phase: balloon.BalloonPhase;
  readonly roomCode: string;
  readonly hostId: string;
  readonly options: BalloonOptionsView;
  readonly players: readonly BalloonPlayerView[];
  readonly total: number;
  readonly turnPumps: number;
  readonly maxPops: number;
  readonly history: readonly BalloonTurnView[];
  readonly currentTurn: string;
  readonly turnId: string;
  readonly deadline: number;
  readonly phaseEndsAt: number;
  readonly loserId: string;
  /** 끝난 뒤에만 0이 아니다 (BL-20) */
  readonly threshold: number;
}

/** 방금 분 펌프 (알림 줄, 1.5초) */
export interface PumpFlash {
  readonly playerId: string;
  readonly total: number;
  readonly turnPumps: number;
  readonly isAuto: boolean;
  readonly at: number;
}

export interface BalloonSnapshot extends BaseSnapshot<BalloonView> {
  readonly flash: PumpFlash | null;
}

interface SchemaLike {
  toJSON(): unknown;
}

function readView(state: SchemaLike): BalloonView {
  const raw = state.toJSON() as Omit<BalloonView, 'players'> & {
    players?: Record<string, BalloonPlayerView>;
  };
  return { ...raw, players: Object.values(raw.players ?? {}), history: raw.history ?? [] };
}

/** 풍선 터뜨리기 방 하나와의 연결 (docs/specs/balloon.md 6장). 연결 공통 부분은 RoomSession (ADR 0003) */
export class BalloonSession extends RoomSession<BalloonView, BalloonSnapshot> {
  private constructor(room: Room) {
    super(room, (state) => readView(state as SchemaLike), { flash: null });
  }

  static create(
    nickname: string,
    options: Partial<balloon.BalloonRoomOptions> = {},
  ): Promise<BalloonSession> {
    return connectSession(
      balloon.BALLOON_ROOM_TYPE,
      nickname,
      { kind: 'create', options },
      (r) => new BalloonSession(r),
    );
  }

  static join(code: string, nickname: string): Promise<BalloonSession> {
    return connectSession(
      balloon.BALLOON_ROOM_TYPE,
      nickname,
      { kind: 'join', code },
      (r) => new BalloonSession(r),
    );
  }

  static quickMatch(nickname: string): Promise<BalloonSession> {
    return connectSession(
      balloon.BALLOON_ROOM_TYPE,
      nickname,
      { kind: 'quick' },
      (r) => new BalloonSession(r),
    );
  }

  send<T extends balloon.BalloonClientMessageType>(type: T, payload: balloon.BalloonClientMessages[T]): void {
    this.room.send(type, payload);
  }

  protected override onState(view: BalloonView): Partial<BalloonSnapshot> {
    return view.total === 0 && view.history.length === 0 ? { view, flash: null } : { view };
  }

  protected onGameMessage(type: string, p: Record<string, unknown>): void {
    if (type !== 'pumped') return;
    this.update({
      flash: {
        playerId: String(p.playerId),
        total: Number(p.total),
        turnPumps: Number(p.turnPumps),
        isAuto: p.isAuto === true,
        at: Date.now(),
      },
    });
  }
}
