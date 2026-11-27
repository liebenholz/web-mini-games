import type { Room } from '@colyseus/sdk';
import { updown } from '@wmg/rules';
import { connectSession, RoomSession, type BaseSnapshot } from '../roomSession.js';

export interface UpdownPlayerView {
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

export interface UpdownOptionsView {
  readonly rangeMax: updown.UpdownRange;
  readonly maxPlayers: number;
  readonly turnSeconds: updown.UpdownTurnSeconds;
  readonly fillWithBots: boolean;
  readonly isPrivate: boolean;
}

export interface UpdownCallView {
  readonly playerId: string;
  readonly value: number;
  readonly result: updown.CallResult;
  readonly isAuto: boolean;
}

export interface UpdownView {
  readonly phase: updown.UpdownPhase;
  readonly roomCode: string;
  readonly hostId: string;
  readonly options: UpdownOptionsView;
  readonly players: readonly UpdownPlayerView[];
  readonly low: number;
  readonly high: number;
  readonly history: readonly UpdownCallView[];
  readonly currentTurn: string;
  readonly turnId: string;
  readonly deadline: number;
  readonly phaseEndsAt: number;
  readonly loserId: string;
  /** 끝난 뒤에만 0이 아니다 (UD-20) */
  readonly bomb: number;
  readonly forced: boolean;
}

/** 방금 말한 결과 (알림 줄, 1.5초) */
export interface CallFlash extends UpdownCallView {
  readonly at: number;
}

export interface UpdownSnapshot extends BaseSnapshot<UpdownView> {
  readonly flash: CallFlash | null;
}

interface SchemaLike {
  toJSON(): unknown;
}

function readView(state: SchemaLike): UpdownView {
  const raw = state.toJSON() as Omit<UpdownView, 'players'> & { players?: Record<string, UpdownPlayerView> };
  return { ...raw, players: Object.values(raw.players ?? {}), history: raw.history ?? [] };
}

/** 업다운 숫자폭탄 방 하나와의 연결 (docs/specs/updown-bomb.md 6장). 연결 공통 부분은 RoomSession (ADR 0003) */
export class UpdownSession extends RoomSession<UpdownView, UpdownSnapshot> {
  private constructor(room: Room) {
    super(room, (state) => readView(state as SchemaLike), { flash: null });
  }

  static create(nickname: string, options: Partial<updown.UpdownRoomOptions> = {}): Promise<UpdownSession> {
    return connectSession(
      updown.UPDOWN_ROOM_TYPE,
      nickname,
      { kind: 'create', options },
      (r) => new UpdownSession(r),
    );
  }

  static join(code: string, nickname: string): Promise<UpdownSession> {
    return connectSession(
      updown.UPDOWN_ROOM_TYPE,
      nickname,
      { kind: 'join', code },
      (r) => new UpdownSession(r),
    );
  }

  static quickMatch(nickname: string): Promise<UpdownSession> {
    return connectSession(updown.UPDOWN_ROOM_TYPE, nickname, { kind: 'quick' }, (r) => new UpdownSession(r));
  }

  send<T extends updown.UpdownClientMessageType>(type: T, payload: updown.UpdownClientMessages[T]): void {
    this.room.send(type, payload);
  }

  protected override onState(view: UpdownView): Partial<UpdownSnapshot> {
    return view.history.length === 0 ? { view, flash: null } : { view };
  }

  protected onGameMessage(type: string, p: Record<string, unknown>): void {
    if (type !== 'number_called') return;
    this.update({
      flash: {
        playerId: String(p.playerId),
        value: Number(p.value),
        result: p.result as updown.CallResult,
        isAuto: p.isAuto === true,
        at: Date.now(),
      },
    });
  }
}
