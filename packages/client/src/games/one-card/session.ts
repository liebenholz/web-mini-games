import type { Room } from '@colyseus/sdk';
import { oneCard } from '@wmg/rules';
import { toast } from '../../dom.js';
import { guestId } from '../../identity.js';
import { closeReason, describeError, JoinError, sdk, toJoinError } from '../../net.js';

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

export interface OneCardNotice {
  readonly playerId: string;
  readonly nickname: string;
  readonly reason: oneCard.ReplaceReason;
  readonly at: number;
}

/** 원카드 창 판정 결과 (C-31) */
export interface OneCardCall {
  readonly windowId: string;
  readonly callerId: string | null;
  readonly playerId: string;
  readonly result: 'safe' | 'penalty' | 'expired';
  readonly at: number;
}

export interface OneCardSnapshot {
  readonly view: OneCardView;
  readonly me: string;
  readonly role: 'player' | 'spectator';
  readonly clockOffset: number;
  readonly notice: OneCardNotice | null;
  readonly connection: 'online' | 'reconnecting';
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

/** 원카드 방 하나와의 연결 (docs/specs/one-card.md 9장). 내 패는 your_hand로만 온다 (C-40) */
export class OneCardSession {
  #listeners = new Set<(s: OneCardSnapshot) => void>();
  #closed = new Set<(reason: string | null) => void>();
  #snapshot: OneCardSnapshot;

  private constructor(readonly room: Room) {
    this.#snapshot = {
      view: readView(room.state as SchemaLike),
      me: '',
      role: 'player',
      clockOffset: 0,
      notice: null,
      connection: 'online',
      hand: [],
      drawn: null,
      call: null,
      ranking: [],
    };
    room.reconnection.maxRetries = 30;
    room.onStateChange((state) => this.#update({ view: readView(state as SchemaLike) }));
    room.onMessage('*', (type, payload) => this.#onMessage(String(type), payload as Record<string, unknown>));
    room.onDrop(() => this.#update({ connection: 'reconnecting' }));
    room.onReconnect(() => this.#update({ connection: 'online' }));
    room.onLeave((code) => {
      const reason = closeReason(code);
      for (const fn of this.#closed) fn(reason);
    });
  }

  static async create(
    nickname: string,
    options: Partial<oneCard.OneCardRoomOptions> = {},
  ): Promise<OneCardSession> {
    try {
      const room = await sdk().create(oneCard.ONE_CARD_ROOM_TYPE, { guestId: guestId(), nickname, options });
      return await new OneCardSession(room).#ready();
    } catch (error) {
      throw error instanceof JoinError ? error : toJoinError(error);
    }
  }

  static async join(code: string, nickname: string): Promise<OneCardSession> {
    try {
      const room = await sdk().joinById(code, { guestId: guestId(), nickname });
      // 방 코드는 모든 게임이 같은 공간을 쓴다 (ADR 0002)
      if (room.name !== oneCard.ONE_CARD_ROOM_TYPE) {
        void room.leave(true).catch(() => undefined);
        throw new JoinError('ROOM_NOT_FOUND');
      }
      return await new OneCardSession(room).#ready();
    } catch (error) {
      throw error instanceof JoinError ? error : toJoinError(error);
    }
  }

  static async quickMatch(nickname: string): Promise<OneCardSession> {
    try {
      const room = await sdk().joinOrCreate(oneCard.ONE_CARD_ROOM_TYPE, {
        guestId: guestId(),
        nickname,
        options: { isPrivate: false },
      });
      return await new OneCardSession(room).#ready();
    } catch (error) {
      throw error instanceof JoinError ? error : toJoinError(error);
    }
  }

  get snapshot(): OneCardSnapshot {
    return this.#snapshot;
  }

  get roomCode(): string {
    return this.#snapshot.view.roomCode || this.room.roomId;
  }

  serverNow(): number {
    return Date.now() + this.#snapshot.clockOffset;
  }

  subscribe(fn: (s: OneCardSnapshot) => void): () => void {
    this.#listeners.add(fn);
    fn(this.#snapshot);
    return () => this.#listeners.delete(fn);
  }

  onClosed(fn: (reason: string | null) => void): () => void {
    this.#closed.add(fn);
    return () => this.#closed.delete(fn);
  }

  send<T extends oneCard.OneCardClientMessageType>(type: T, payload: oneCard.OneCardClientMessages[T]): void {
    this.room.send(type, payload);
  }

  async leave(): Promise<void> {
    await this.room.leave(true).catch(() => undefined);
  }

  #ready(): Promise<OneCardSession> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new JoinError('NETWORK')), 8000);
      const check = (s: OneCardSnapshot) => {
        if (!s.me) return;
        window.clearTimeout(timer);
        this.#listeners.delete(check);
        resolve(this);
      };
      this.#listeners.add(check);
    });
  }

  #onMessage(type: string, p: Record<string, unknown>): void {
    switch (type) {
      case 'welcome':
        this.#update({ me: String(p.playerId), role: p.role === 'spectator' ? 'spectator' : 'player' });
        break;
      case 'turn_start':
        this.#update({ clockOffset: Number(p.serverNow) - Date.now() });
        break;
      case 'player_replaced':
        this.#update({
          notice: {
            playerId: String(p.playerId),
            nickname: String(p.nickname),
            reason: p.reason as oneCard.ReplaceReason,
            at: Date.now(),
          },
        });
        break;
      case 'your_hand':
        this.#update({
          hand: Array.isArray(p.cards) ? (p.cards as string[]) : [],
          drawn: typeof p.drawn === 'string' ? p.drawn : null,
        });
        break;
      case 'one_card_called':
        this.#update({
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
        this.#update({ ranking: Array.isArray(p.ranking) ? (p.ranking as OneCardSnapshot['ranking']) : [] });
        break;
      case 'error':
        toast(describeError(String(p.code)));
        break;
      default:
        break;
    }
  }

  #update(patch: Partial<OneCardSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch };
    for (const fn of [...this.#listeners]) fn(this.#snapshot);
  }
}
