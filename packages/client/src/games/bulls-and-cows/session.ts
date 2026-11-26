import type { Room } from '@colyseus/sdk';
import { bulls } from '@wmg/rules';
import { toast } from '../../dom.js';
import { guestId } from '../../identity.js';
import { watchReconnect } from '../../errorReport.js';
import { closeReason, describeError, JoinError, joinFailure, sdk } from '../../net.js';

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

export interface BullsNotice {
  readonly playerId: string;
  readonly nickname: string;
  readonly reason: bulls.ReplaceReason;
  readonly at: number;
}

export interface BullsSnapshot {
  readonly view: BullsView;
  readonly me: string;
  readonly role: 'player' | 'spectator';
  readonly clockOffset: number;
  readonly notice: BullsNotice | null;
  readonly connection: 'online' | 'reconnecting';
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

/** 숫자야구 방 하나와의 연결 (docs/specs/bulls-and-cows.md 6장). 내 비밀 숫자는 your_secret으로만 온다 (B-21) */
export class BullsSession {
  #listeners = new Set<(s: BullsSnapshot) => void>();
  #closed = new Set<(reason: string | null) => void>();
  #snapshot: BullsSnapshot;

  private constructor(readonly room: Room) {
    this.#snapshot = {
      view: readView(room.state as SchemaLike),
      me: '',
      role: 'player',
      clockOffset: 0,
      notice: null,
      connection: 'online',
      secret: '',
      over: null,
    };
    room.reconnection.maxRetries = 30;
    room.onStateChange((state) => {
      const view = readView(state as SchemaLike);
      // 새 판이 시작되면(대기실 → 시작) 지난 판의 비밀 숫자와 결과를 지운다
      const fresh = view.phase === 'STARTING' && this.#snapshot.view.phase !== 'STARTING';
      this.#update(fresh ? { view, secret: '', over: null } : { view });
    });
    room.onMessage('*', (type, payload) => this.#onMessage(String(type), payload as Record<string, unknown>));
    watchReconnect(room);
    room.onDrop(() => this.#update({ connection: 'reconnecting' }));
    room.onReconnect(() => this.#update({ connection: 'online' }));
    room.onLeave((code) => {
      const reason = closeReason(code);
      for (const fn of this.#closed) fn(reason);
    });
  }

  static async create(
    nickname: string,
    options: Partial<bulls.BullsRoomOptions> = {},
  ): Promise<BullsSession> {
    try {
      const room = await sdk().create(bulls.BULLS_ROOM_TYPE, { guestId: guestId(), nickname, options });
      return await new BullsSession(room).#ready();
    } catch (error) {
      throw joinFailure(error);
    }
  }

  static async join(code: string, nickname: string): Promise<BullsSession> {
    try {
      const room = await sdk().joinById(code, { guestId: guestId(), nickname });
      // 방 코드는 모든 게임이 같은 공간을 쓴다 (ADR 0002)
      if (room.name !== bulls.BULLS_ROOM_TYPE) {
        void room.leave(true).catch(() => undefined);
        throw new JoinError('ROOM_NOT_FOUND');
      }
      return await new BullsSession(room).#ready();
    } catch (error) {
      throw joinFailure(error);
    }
  }

  static async quickMatch(nickname: string): Promise<BullsSession> {
    try {
      const room = await sdk().joinOrCreate(bulls.BULLS_ROOM_TYPE, {
        guestId: guestId(),
        nickname,
        options: { isPrivate: false },
      });
      return await new BullsSession(room).#ready();
    } catch (error) {
      throw joinFailure(error);
    }
  }

  get snapshot(): BullsSnapshot {
    return this.#snapshot;
  }

  get roomCode(): string {
    return this.#snapshot.view.roomCode || this.room.roomId;
  }

  serverNow(): number {
    return Date.now() + this.#snapshot.clockOffset;
  }

  subscribe(fn: (s: BullsSnapshot) => void): () => void {
    this.#listeners.add(fn);
    fn(this.#snapshot);
    return () => this.#listeners.delete(fn);
  }

  onClosed(fn: (reason: string | null) => void): () => void {
    this.#closed.add(fn);
    return () => this.#closed.delete(fn);
  }

  send<T extends bulls.BullsClientMessageType>(type: T, payload: bulls.BullsClientMessages[T]): void {
    this.room.send(type, payload);
  }

  async leave(): Promise<void> {
    await this.room.leave(true).catch(() => undefined);
  }

  #ready(): Promise<BullsSession> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new JoinError('NETWORK')), 8000);
      const check = (s: BullsSnapshot) => {
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
            reason: p.reason as bulls.ReplaceReason,
            at: Date.now(),
          },
        });
        break;
      case 'your_secret':
        this.#update({ secret: typeof p.digits === 'string' ? p.digits : '' });
        break;
      case 'game_over':
        this.#update({
          over: {
            secrets: (p.secrets ?? {}) as Record<string, string>,
            attempts: (p.attempts ?? {}) as Record<string, number>,
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

  #update(patch: Partial<BullsSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch };
    for (const fn of [...this.#listeners]) fn(this.#snapshot);
  }
}
