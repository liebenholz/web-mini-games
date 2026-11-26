import type { Room } from '@colyseus/sdk';
import { oneCard } from '@wmg/rules';
import { connectSession, RoomSession, type BaseSnapshot, type PlayerNotice } from '../roomSession.js';

export interface OneCardPlayerView {
  readonly id: string;
  readonly nickname: string;
  readonly isBot: boolean;
  readonly isHost: boolean;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly spectator: boolean;
  /** 대기실에서는 -1 */
  readonly seat: number;
  readonly handCount: number;
  readonly status: '' | oneCard.SeatStatus;
  readonly rank: number;
  readonly replaced: boolean;
  readonly autopilot: boolean;
}

export interface OneCardOptionsView {
  readonly maxPlayers: number;
  readonly turnSeconds: 15 | 30 | 60;
  readonly fillWithBots: boolean;
  readonly isPrivate: boolean;
}

/** 공유 상태: 공개 정보만 (C-41) */
export interface OneCardView {
  readonly phase: oneCard.OneCardPhase;
  readonly roomCode: string;
  readonly hostId: string;
  readonly options: OneCardOptionsView;
  readonly players: readonly OneCardPlayerView[];
  readonly topCard: string;
  readonly chosenSuit: '' | oneCard.Suit;
  readonly attack: number;
  readonly direction: number;
  readonly deckCount: number;
  readonly currentTurn: string;
  readonly turnId: string;
  readonly deadline: number;
  readonly phaseEndsAt: number;
  readonly windowId: string;
  readonly windowTarget: string;
  readonly windowClosesAt: number;
}

export type OneCardNotice = PlayerNotice;

/** 원카드 창 판정 결과 (C-31) */
export interface OneCardCall {
  readonly windowId: string;
  readonly callerId: string | null;
  readonly playerId: string;
  readonly result: 'safe' | 'penalty' | 'expired';
  readonly at: number;
}

export interface OneCardSnapshot extends BaseSnapshot<OneCardView> {
  /** 내 패 (본인에게만 온다) */
  readonly hand: readonly string[];
  /** C-14: 이번 차례에 가져온 카드. 이 카드만 낼 수 있다 */
  readonly drawn: string | null;
  readonly call: OneCardCall | null;
  readonly ranking: readonly {
    readonly playerId: string;
    readonly rank: number;
    readonly bankrupt: boolean;
  }[];
}

interface SchemaLike {
  toJSON(): unknown;
}

function readView(state: SchemaLike): OneCardView {
  const raw = state.toJSON() as Omit<OneCardView, 'players'> & {
    players?: Record<string, OneCardPlayerView>;
  };
  return {
    ...raw,
    players: Object.values(raw.players ?? {}),
  };
}

/** 원카드 방 하나와의 연결 (docs/specs/one-card.md). 연결 공통 부분은 RoomSession (ADR 0003) */
export class OneCardSession extends RoomSession<OneCardView, OneCardSnapshot> {
  private constructor(room: Room) {
    super(room, (state) => readView(state as SchemaLike), { hand: [], drawn: null, call: null, ranking: [] });
  }

  static create(
    nickname: string,
    options: Partial<oneCard.OneCardRoomOptions> = {},
  ): Promise<OneCardSession> {
    return connectSession(
      oneCard.ONE_CARD_ROOM_TYPE,
      nickname,
      { kind: 'create', options },
      (r) => new OneCardSession(r),
    );
  }

  static join(code: string, nickname: string): Promise<OneCardSession> {
    return connectSession(
      oneCard.ONE_CARD_ROOM_TYPE,
      nickname,
      { kind: 'join', code },
      (r) => new OneCardSession(r),
    );
  }

  static quickMatch(nickname: string): Promise<OneCardSession> {
    return connectSession(
      oneCard.ONE_CARD_ROOM_TYPE,
      nickname,
      { kind: 'quick' },
      (r) => new OneCardSession(r),
    );
  }

  send<T extends oneCard.OneCardClientMessageType>(type: T, payload: oneCard.OneCardClientMessages[T]): void {
    this.room.send(type, payload);
  }

  protected onGameMessage(type: string, p: Record<string, unknown>): void {
    switch (type) {
      case 'your_hand':
        this.update({
          hand: Array.isArray(p.cards) ? (p.cards as string[]) : [],
          drawn: typeof p.drawn === 'string' ? p.drawn : null,
        });
        break;
      case 'one_card_called':
        this.update({
          call: {
            windowId: String(p.windowId),
            callerId: typeof p.callerId === 'string' ? p.callerId : null,
            playerId: String(p.playerId),
            result: p.result as OneCardCall['result'],
            at: Date.now(),
          },
        });
        break;
      case 'game_over':
        this.update({ ranking: Array.isArray(p.ranking) ? (p.ranking as OneCardSnapshot['ranking']) : [] });
        break;
    }
  }
}
