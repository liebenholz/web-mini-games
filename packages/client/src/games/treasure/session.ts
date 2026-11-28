import type { Room } from '@colyseus/sdk';
import { treasure } from '@wmg/rules';
import { connectSession, RoomSession, type BaseSnapshot } from '../roomSession.js';

export interface TreasurePlayerView {
  readonly id: string;
  readonly nickname: string;
  readonly isBot: boolean;
  readonly isHost: boolean;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly spectator: boolean;
  readonly seat: number;
  readonly locked: boolean;
  readonly inRound: boolean;
  readonly replaced: boolean;
  readonly autopilot: boolean;
}

export interface TreasureOptionsView {
  readonly maxPlayers: number;
  readonly pickSeconds: treasure.TreasurePickSeconds;
  readonly fillWithBots: boolean;
  readonly isPrivate: boolean;
}

export interface RevealedPickView {
  readonly playerId: string;
  readonly x: number;
  readonly y: number;
  readonly distSq: number;
  readonly isAuto: boolean;
}

export interface RevealView {
  readonly treasureX: number;
  readonly treasureY: number;
  readonly picks: readonly RevealedPickView[];
  /** 가장 먼 사람들의 playerId를 쉼표로 이은 값 */
  readonly far: string;
  readonly tie: boolean;
}

export interface TreasureView {
  readonly phase: treasure.TreasurePhase;
  readonly roomCode: string;
  readonly hostId: string;
  readonly options: TreasureOptionsView;
  readonly players: readonly TreasurePlayerView[];
  readonly roundId: string;
  readonly replay: number;
  readonly deadline: number;
  readonly phaseEndsAt: number;
  /** REVEAL 이후에만 true. 그 전에는 reveal이 비어 있다 (BH-20) */
  readonly hasReveal: boolean;
  readonly reveal: RevealView;
  readonly loserId: string;
  readonly tieBreak: boolean;
}

/** 서버가 받아 둔 내 선택 (본인에게만 온다, BH-21) */
export interface MyPick {
  readonly roundId: string;
  readonly x: number;
  readonly y: number;
  readonly locked: boolean;
}

export interface TreasureSnapshot extends BaseSnapshot<TreasureView> {
  readonly myPick: MyPick | null;
}

interface SchemaLike {
  toJSON(): unknown;
}

function readView(state: SchemaLike): TreasureView {
  const raw = state.toJSON() as Omit<TreasureView, 'players' | 'reveal'> & {
    players?: Record<string, TreasurePlayerView>;
    reveal?: Partial<RevealView>;
  };
  return {
    ...raw,
    players: Object.values(raw.players ?? {}),
    reveal: {
      treasureX: raw.reveal?.treasureX ?? 0,
      treasureY: raw.reveal?.treasureY ?? 0,
      picks: raw.reveal?.picks ?? [],
      far: raw.reveal?.far ?? '',
      tie: raw.reveal?.tie ?? false,
    },
  };
}

/** 보물 찾기 방 하나와의 연결 (docs/specs/treasure.md 6장). 연결 공통 부분은 RoomSession (ADR 0003) */
export class TreasureSession extends RoomSession<TreasureView, TreasureSnapshot> {
  private constructor(room: Room) {
    super(room, (state) => readView(state as SchemaLike), { myPick: null });
  }

  static create(
    nickname: string,
    options: Partial<treasure.TreasureRoomOptions> = {},
  ): Promise<TreasureSession> {
    return connectSession(
      treasure.TREASURE_ROOM_TYPE,
      nickname,
      { kind: 'create', options },
      (r) => new TreasureSession(r),
    );
  }

  static join(code: string, nickname: string): Promise<TreasureSession> {
    return connectSession(
      treasure.TREASURE_ROOM_TYPE,
      nickname,
      { kind: 'join', code },
      (r) => new TreasureSession(r),
    );
  }

  static quickMatch(nickname: string): Promise<TreasureSession> {
    return connectSession(
      treasure.TREASURE_ROOM_TYPE,
      nickname,
      { kind: 'quick' },
      (r) => new TreasureSession(r),
    );
  }

  send<T extends treasure.TreasureClientMessageType>(
    type: T,
    payload: treasure.TreasureClientMessages[T],
  ): void {
    this.room.send(type, payload);
  }

  /** 새 선택 단계나 대기실이면 지난 선택을 지운다 */
  protected override onState(view: TreasureView): Partial<TreasureSnapshot> {
    const mine = this.snapshot.myPick;
    if (mine && mine.roundId !== view.roundId) return { view, myPick: null };
    if (view.phase === 'WAITING') return { view, myPick: null };
    return { view };
  }

  protected onGameMessage(type: string, p: Record<string, unknown>): void {
    if (type !== 'your_pick') return;
    this.update({
      myPick: { roundId: String(p.roundId), x: Number(p.x), y: Number(p.y), locked: p.locked === true },
    });
  }
}
