import type { Room } from '@colyseus/sdk';
import { bulls } from '@wmg/rules';
import { connectSession, RoomSession, type BaseSnapshot, type PlayerNotice } from '../roomSession.js';

export interface BullsPlayerView {
  readonly id: string;
  readonly nickname: string;
  readonly isBot: boolean;
  readonly isHost: boolean;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly spectator: boolean;
  /** 대기실 -1, 0 선공, 1 후공 */
  readonly seat: number;
  readonly secretSet: boolean;
  readonly attempts: number;
  /** 게임이 끝난 뒤에만 채워진다 (B-23) */
  readonly revealed: string;
  readonly replaced: boolean;
  readonly autopilot: boolean;
}

export interface BullsOptionsView {
  readonly digits: bulls.Digits;
  readonly maxAttempts: bulls.MaxAttempts;
  readonly turnSeconds: bulls.BullsTurnSeconds;
  readonly fillWithBots: boolean;
  readonly isPrivate: boolean;
}

export interface BullsGuessView {
  readonly playerId: string;
  /** 시간 초과로 넘긴 턴이면 '' */
  readonly guess: string;
  readonly strikes: number;
  readonly balls: number;
  readonly skipped: boolean;
  readonly isAuto: boolean;
}

/** 공유 상태: 비밀 숫자는 없다 (B-20) */
export interface BullsView {
  readonly phase: bulls.BullsPhase;
  readonly roomCode: string;
  readonly hostId: string;
  readonly options: BullsOptionsView;
  readonly players: readonly BullsPlayerView[];
  readonly history: readonly BullsGuessView[];
  readonly currentTurn: string;
  readonly turnId: string;
  readonly deadline: number;
  readonly phaseEndsAt: number;
  readonly lastChance: boolean;
  readonly result: '' | bulls.BullsEndResult;
  readonly winnerId: string;
}

export type BullsNotice = PlayerNotice;

export interface BullsSnapshot extends BaseSnapshot<BullsView> {
  /** 내 비밀 숫자 (본인에게만 온다) */
  readonly secret: string;
  /** 게임이 끝나면 두 비밀 숫자와 시도 횟수 */
  readonly over: {
    readonly secrets: Record<string, string>;
    readonly attempts: Record<string, number>;
  } | null;
}

interface SchemaLike {
  toJSON(): unknown;
}

function readView(state: SchemaLike): BullsView {
  const raw = state.toJSON() as Omit<BullsView, 'players'> & {
    players?: Record<string, BullsPlayerView>;
  };
  return {
    ...raw,
    players: Object.values(raw.players ?? {}),
    history: raw.history ?? [],
  };
}

/** 숫자야구 방 하나와의 연결 (docs/specs/bulls-and-cows.md). 연결 공통 부분은 RoomSession (ADR 0003) */
export class BullsSession extends RoomSession<BullsView, BullsSnapshot> {
  private constructor(room: Room) {
    super(room, (state) => readView(state as SchemaLike), { secret: '', over: null });
  }

  static create(nickname: string, options: Partial<bulls.BullsRoomOptions> = {}): Promise<BullsSession> {
    return connectSession(
      bulls.BULLS_ROOM_TYPE,
      nickname,
      { kind: 'create', options },
      (r) => new BullsSession(r),
    );
  }

  static join(code: string, nickname: string): Promise<BullsSession> {
    return connectSession(
      bulls.BULLS_ROOM_TYPE,
      nickname,
      { kind: 'join', code },
      (r) => new BullsSession(r),
    );
  }

  static quickMatch(nickname: string): Promise<BullsSession> {
    return connectSession(bulls.BULLS_ROOM_TYPE, nickname, { kind: 'quick' }, (r) => new BullsSession(r));
  }

  send<T extends bulls.BullsClientMessageType>(type: T, payload: bulls.BullsClientMessages[T]): void {
    this.room.send(type, payload);
  }

  /** 새 판이 시작되면(대기실 → 시작) 지난 판의 비밀 숫자와 결과를 지운다 */
  protected override onState(view: BullsView): Partial<BullsSnapshot> {
    const fresh = view.phase === 'STARTING' && this.snapshot.view.phase !== 'STARTING';
    return fresh ? { view, secret: '', over: null } : { view };
  }

  protected onGameMessage(type: string, p: Record<string, unknown>): void {
    switch (type) {
      case 'your_secret':
        this.update({ secret: typeof p.digits === 'string' ? p.digits : '' });
        break;
      case 'game_over':
        this.update({
          over: {
            secrets: (p.secrets ?? {}) as Record<string, string>,
            attempts: (p.attempts ?? {}) as Record<string, number>,
          },
        });
        break;
    }
  }
}
