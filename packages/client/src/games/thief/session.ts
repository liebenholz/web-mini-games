import type { Room } from '@colyseus/sdk';
import { thief } from '@wmg/rules';
import { connectSession, RoomSession, type BaseSnapshot } from '../roomSession.js';

export interface ThiefPlayerView {
  readonly id: string;
  readonly nickname: string;
  readonly isBot: boolean;
  readonly isHost: boolean;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly spectator: boolean;
  readonly seat: number;
  readonly handCount: number;
  readonly out: boolean;
  readonly outOrder: number;
  /** 끝난 뒤 마지막 패 */
  readonly finalHand: readonly string[];
  readonly replaced: boolean;
  readonly autopilot: boolean;
}

export interface ThiefOptionsView {
  readonly maxPlayers: number;
  readonly turnSeconds: thief.ThiefTurnSeconds;
  readonly fillWithBots: boolean;
  readonly isPrivate: boolean;
}

export interface ThiefView {
  readonly phase: thief.ThiefPhase;
  readonly roomCode: string;
  readonly hostId: string;
  readonly options: ThiefOptionsView;
  readonly players: readonly ThiefPlayerView[];
  readonly currentTurn: string;
  readonly targetId: string;
  readonly turnId: string;
  readonly deadline: number;
  readonly phaseEndsAt: number;
  /** 내려놓은 짝의 숫자 (공개) */
  readonly pairs: readonly string[];
  readonly draws: number;
  readonly loserId: string;
}

/** 방금 한 뽑기 (알림 줄) */
export interface DrawFlash {
  readonly fromId: string;
  readonly toId: string;
  readonly matched: string | null;
  readonly isAuto: boolean;
  readonly isBot: boolean;
  readonly at: number;
}

export interface ThiefSnapshot extends BaseSnapshot<ThiefView> {
  /** 내 패 (본인에게만 온다, 원칙 4) */
  readonly hand: readonly string[];
  readonly flash: DrawFlash | null;
}

interface SchemaLike {
  toJSON(): unknown;
}

function readView(state: SchemaLike): ThiefView {
  const raw = state.toJSON() as Omit<ThiefView, 'players' | 'pairs'> & {
    players?: Record<string, ThiefPlayerView>;
    pairs?: string[];
  };
  return {
    ...raw,
    players: Object.values(raw.players ?? {}).map((p) => ({ ...p, finalHand: p.finalHand ?? [] })),
    pairs: raw.pairs ?? [],
  };
}

/** 도둑잡기 방 하나와의 연결 (docs/specs/thief.md 5장). 연결 공통 부분은 RoomSession (ADR 0003) */
export class ThiefSession extends RoomSession<ThiefView, ThiefSnapshot> {
  private constructor(room: Room) {
    super(room, (state) => readView(state as SchemaLike), { hand: [], flash: null });
  }

  static create(nickname: string, options: Partial<thief.ThiefRoomOptions> = {}): Promise<ThiefSession> {
    return connectSession(
      thief.THIEF_ROOM_TYPE,
      nickname,
      { kind: 'create', options },
      (r) => new ThiefSession(r),
    );
  }

  static join(code: string, nickname: string): Promise<ThiefSession> {
    return connectSession(
      thief.THIEF_ROOM_TYPE,
      nickname,
      { kind: 'join', code },
      (r) => new ThiefSession(r),
    );
  }

  static quickMatch(nickname: string): Promise<ThiefSession> {
    return connectSession(thief.THIEF_ROOM_TYPE, nickname, { kind: 'quick' }, (r) => new ThiefSession(r));
  }

  send<T extends thief.ThiefClientMessageType>(type: T, payload: thief.ThiefClientMessages[T]): void {
    this.room.send(type, payload);
  }

  protected override onState(view: ThiefView): Partial<ThiefSnapshot> {
    return view.draws === 0 ? { view, flash: null } : { view };
  }

  protected onGameMessage(type: string, p: Record<string, unknown>): void {
    if (type === 'your_hand') {
      this.update({ hand: Array.isArray(p.cards) ? (p.cards as string[]) : [] });
      return;
    }
    if (type !== 'drawn') return;
    this.update({
      flash: {
        fromId: String(p.fromId),
        toId: String(p.toId),
        matched: typeof p.matched === 'string' ? p.matched : null,
        isAuto: p.isAuto === true,
        isBot: p.isBot === true,
        at: Date.now(),
      },
    });
  }
}
