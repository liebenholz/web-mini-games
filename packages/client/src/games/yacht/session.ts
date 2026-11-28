import type { Room } from '@colyseus/sdk';
import { yacht } from '@wmg/rules';
import { connectSession, RoomSession, type BaseSnapshot } from '../roomSession.js';

export interface YachtPlayerView {
  readonly id: string;
  readonly nickname: string;
  readonly isBot: boolean;
  readonly isHost: boolean;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly spectator: boolean;
  readonly seat: number;
  /** 12칸. 아직 안 쓴 칸은 -1 */
  readonly scores: readonly number[];
  readonly upperSum: number;
  readonly bonus: number;
  readonly total: number;
  readonly replaced: boolean;
  readonly autopilot: boolean;
}

export interface YachtOptionsView {
  readonly maxPlayers: number;
  readonly turnSeconds: yacht.YachtTurnSeconds;
  readonly fillWithBots: boolean;
  readonly isPrivate: boolean;
}

export interface YachtView {
  readonly phase: yacht.YachtPhase;
  readonly roomCode: string;
  readonly hostId: string;
  readonly options: YachtOptionsView;
  readonly players: readonly YachtPlayerView[];
  readonly currentTurn: string;
  readonly turnId: string;
  readonly deadline: number;
  readonly phaseEndsAt: number;
  readonly dice: readonly number[];
  /** 마지막 굴림에서 남긴 주사위 (1 = 남김) */
  readonly held: readonly number[];
  readonly rollNo: number;
  readonly turnsDone: number;
}

/** 방금 기록한 칸 (알림 줄, 몇 초) */
export interface ScoredFlash {
  readonly playerId: string;
  readonly category: number;
  readonly points: number;
  readonly isAuto: boolean;
  readonly isBot: boolean;
  readonly at: number;
}

export interface YachtSnapshot extends BaseSnapshot<YachtView> {
  readonly flash: ScoredFlash | null;
}

interface SchemaLike {
  toJSON(): unknown;
}

function readView(state: SchemaLike): YachtView {
  const raw = state.toJSON() as Omit<YachtView, 'players' | 'dice' | 'held'> & {
    players?: Record<string, YachtPlayerView & { scores?: number[] }>;
    dice?: number[];
    held?: number[];
  };
  return {
    ...raw,
    players: Object.values(raw.players ?? {}).map((p) => ({
      ...p,
      scores: p.scores?.length ? p.scores : new Array<number>(yacht.CATEGORY_COUNT).fill(yacht.EMPTY),
    })),
    dice: raw.dice ?? [],
    held: raw.held ?? [],
  };
}

/** 요트 주사위 방 하나와의 연결 (docs/specs/yacht.md 6장). 연결 공통 부분은 RoomSession (ADR 0003) */
export class YachtSession extends RoomSession<YachtView, YachtSnapshot> {
  private constructor(room: Room) {
    super(room, (state) => readView(state as SchemaLike), { flash: null });
  }

  static create(nickname: string, options: Partial<yacht.YachtRoomOptions> = {}): Promise<YachtSession> {
    return connectSession(
      yacht.YACHT_ROOM_TYPE,
      nickname,
      { kind: 'create', options },
      (r) => new YachtSession(r),
    );
  }

  static join(code: string, nickname: string): Promise<YachtSession> {
    return connectSession(
      yacht.YACHT_ROOM_TYPE,
      nickname,
      { kind: 'join', code },
      (r) => new YachtSession(r),
    );
  }

  static quickMatch(nickname: string): Promise<YachtSession> {
    return connectSession(yacht.YACHT_ROOM_TYPE, nickname, { kind: 'quick' }, (r) => new YachtSession(r));
  }

  send<T extends yacht.YachtClientMessageType>(type: T, payload: yacht.YachtClientMessages[T]): void {
    this.room.send(type, payload);
  }

  protected override onState(view: YachtView): Partial<YachtSnapshot> {
    return view.turnsDone === 0 ? { view, flash: null } : { view };
  }

  protected onGameMessage(type: string, p: Record<string, unknown>): void {
    if (type !== 'scored') return;
    this.update({
      flash: {
        playerId: String(p.playerId),
        category: Number(p.category),
        points: Number(p.points),
        isAuto: p.isAuto === true,
        isBot: p.isBot === true,
        at: Date.now(),
      },
    });
  }
}
