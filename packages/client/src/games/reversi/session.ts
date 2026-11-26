import type { Room } from '@colyseus/sdk';
import { reversi } from '@wmg/rules';
import { connectSession, RoomSession, type BaseSnapshot } from '../roomSession.js';

export interface ReversiPlayerView {
  readonly id: string;
  readonly nickname: string;
  readonly isBot: boolean;
  readonly isHost: boolean;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly spectator: boolean;
  readonly color: '' | reversi.ReversiColor;
  readonly replaced: boolean;
  readonly autopilot: boolean;
}

export interface ReversiOptionsView {
  readonly blackPolicy: reversi.BlackPolicy;
  readonly turnSeconds: 15 | 30 | 60;
  readonly fillWithBots: boolean;
  readonly isPrivate: boolean;
}

export interface ReversiView {
  readonly phase: reversi.ReversiPhase;
  readonly roomCode: string;
  readonly hostId: string;
  readonly options: ReversiOptionsView;
  readonly players: readonly ReversiPlayerView[];
  readonly board: readonly reversi.Cell[];
  readonly moveCount: number;
  readonly passCount: number;
  readonly lastMove: number;
  readonly currentTurn: string;
  readonly turnId: string;
  readonly deadline: number;
  readonly phaseEndsAt: number;
  readonly result: '' | reversi.ReversiResult;
  readonly winnerId: string;
}

/** 방금 뒤집힌 돌 (연출용). 재접속하면 없다 */
export interface FlipEvent {
  readonly from: number;
  readonly indices: readonly number[];
  readonly at: number;
}

/** 한 줄 알림으로 보이는 진행 이벤트 (RV-05 넘김, RV-12 대신 두기) */
export interface TurnEvent {
  readonly kind: 'pass' | 'auto';
  readonly playerId: string;
  readonly at: number;
}

export interface ReversiSnapshot extends BaseSnapshot<ReversiView> {
  readonly flip: FlipEvent | null;
  readonly event: TurnEvent | null;
}

interface SchemaLike {
  toJSON(): unknown;
}

function readView(state: SchemaLike): ReversiView {
  const raw = state.toJSON() as Omit<ReversiView, 'players'> & {
    players?: Record<string, ReversiPlayerView>;
  };
  return { ...raw, players: Object.values(raw.players ?? {}), board: raw.board ?? [] };
}

/** 리버시 방 하나와의 연결 (docs/specs/reversi.md 4장). 연결 공통 부분은 RoomSession (ADR 0003) */
export class ReversiSession extends RoomSession<ReversiView, ReversiSnapshot> {
  private constructor(room: Room) {
    super(room, (state) => readView(state as SchemaLike), { flip: null, event: null });
  }

  static create(
    nickname: string,
    options: Partial<reversi.ReversiRoomOptions> = {},
  ): Promise<ReversiSession> {
    return connectSession(
      reversi.REVERSI_ROOM_TYPE,
      nickname,
      { kind: 'create', options },
      (r) => new ReversiSession(r),
    );
  }

  static join(code: string, nickname: string): Promise<ReversiSession> {
    return connectSession(
      reversi.REVERSI_ROOM_TYPE,
      nickname,
      { kind: 'join', code },
      (r) => new ReversiSession(r),
    );
  }

  static quickMatch(nickname: string): Promise<ReversiSession> {
    return connectSession(
      reversi.REVERSI_ROOM_TYPE,
      nickname,
      { kind: 'quick' },
      (r) => new ReversiSession(r),
    );
  }

  send<T extends reversi.ReversiClientMessageType>(type: T, payload: reversi.ReversiClientMessages[T]): void {
    this.room.send(type, payload);
  }

  /** 새 판이 시작되거나 대기실로 돌아가면 지난 판의 연출을 지운다 */
  protected override onState(view: ReversiView): Partial<ReversiSnapshot> {
    return view.moveCount === 0 ? { view, flip: null, event: null } : { view };
  }

  protected onGameMessage(type: string, p: Record<string, unknown>): void {
    const now = Date.now();
    if (type === 'stone_placed') {
      const flipped = Array.isArray(p.flipped) ? (p.flipped as { x: number; y: number }[]) : [];
      const patch: Partial<ReversiSnapshot> = {
        flip: {
          from: reversi.indexOf({ x: Number(p.x), y: Number(p.y) }),
          indices: flipped.map((f) => reversi.indexOf(f)),
          at: now,
        },
      };
      if (p.isAuto === true) {
        const owner = this.snapshot.view.players.find((x) => x.color === p.color);
        if (owner) Object.assign(patch, { event: { kind: 'auto', playerId: owner.id, at: now } });
      }
      this.update(patch);
    } else if (type === 'turn_passed') {
      this.update({ event: { kind: 'pass', playerId: String(p.playerId), at: now } });
    }
  }
}
