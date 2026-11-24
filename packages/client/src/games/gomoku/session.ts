import type { Room } from '@colyseus/sdk';
import { gomoku } from '@wmg/rules';
import { toast } from '../../dom.js';
import { guestId } from '../../identity.js';
import { closeReason, describeError, JoinError, sdk, toJoinError } from '../../net.js';

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
}

/** 상대에게 띄우는 알림 (G-37) */
export interface GomokuNotice {
  readonly playerId: string;
  readonly nickname: string;
  readonly reason: gomoku.ReplaceReason;
  readonly at: number;
}

export interface GomokuSnapshot {
  readonly view: GomokuView;
  readonly me: string;
  readonly role: 'player' | 'spectator';
  readonly clockOffset: number;
  readonly notice: GomokuNotice | null;
  readonly connection: 'online' | 'reconnecting';
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

/** 오목 방 하나와의 연결 (docs/specs/gomoku.md 6장). 재접속은 SDK 자동 재연결을 쓴다 */
export class GomokuSession {
  #listeners = new Set<(s: GomokuSnapshot) => void>();
  #closed = new Set<(reason: string | null) => void>();
  #snapshot: GomokuSnapshot;

  private constructor(readonly room: Room) {
    this.#snapshot = {
      view: readView(room.state as SchemaLike),
      me: '',
      role: 'player',
      clockOffset: 0,
      notice: null,
      connection: 'online',
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
    options: Partial<gomoku.GomokuRoomOptions> = {},
  ): Promise<GomokuSession> {
    try {
      const room = await sdk().create(gomoku.GOMOKU_ROOM_TYPE, { guestId: guestId(), nickname, options });
      return await new GomokuSession(room).#ready();
    } catch (error) {
      throw error instanceof JoinError ? error : toJoinError(error);
    }
  }

  static async join(code: string, nickname: string): Promise<GomokuSession> {
    try {
      const room = await sdk().joinById(code, { guestId: guestId(), nickname });
      // 방 코드는 모든 게임이 같은 공간을 쓴다 (ADR 0002)
      if (room.name !== gomoku.GOMOKU_ROOM_TYPE) {
        void room.leave(true).catch(() => undefined);
        throw new JoinError('ROOM_NOT_FOUND');
      }
      return await new GomokuSession(room).#ready();
    } catch (error) {
      throw error instanceof JoinError ? error : toJoinError(error);
    }
  }

  static async quickMatch(nickname: string): Promise<GomokuSession> {
    try {
      const room = await sdk().joinOrCreate(gomoku.GOMOKU_ROOM_TYPE, {
        guestId: guestId(),
        nickname,
        options: { isPrivate: false },
      });
      return await new GomokuSession(room).#ready();
    } catch (error) {
      throw error instanceof JoinError ? error : toJoinError(error);
    }
  }

  get snapshot(): GomokuSnapshot {
    return this.#snapshot;
  }

  get roomCode(): string {
    return this.#snapshot.view.roomCode || this.room.roomId;
  }

  serverNow(): number {
    return Date.now() + this.#snapshot.clockOffset;
  }

  subscribe(fn: (s: GomokuSnapshot) => void): () => void {
    this.#listeners.add(fn);
    fn(this.#snapshot);
    return () => this.#listeners.delete(fn);
  }

  onClosed(fn: (reason: string | null) => void): () => void {
    this.#closed.add(fn);
    return () => this.#closed.delete(fn);
  }

  send<T extends gomoku.GomokuClientMessageType>(type: T, payload: gomoku.GomokuClientMessages[T]): void {
    this.room.send(type, payload);
  }

  async leave(): Promise<void> {
    await this.room.leave(true).catch(() => undefined);
  }

  #ready(): Promise<GomokuSession> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new JoinError('NETWORK')), 8000);
      const check = (s: GomokuSnapshot) => {
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
            reason: p.reason as gomoku.ReplaceReason,
            at: Date.now(),
          },
        });
        break;
      case 'error':
        toast(describeError(String(p.code)));
        break;
      default:
        break;
    }
  }

  #update(patch: Partial<GomokuSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch };
    for (const fn of [...this.#listeners]) fn(this.#snapshot);
  }
}
