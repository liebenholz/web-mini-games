import type { Room } from '@colyseus/sdk';
import { toast } from '../dom.js';
import { watchReconnect } from '../errorReport.js';
import { guestId } from '../identity.js';
import { closeReason, describeError, JoinError, joinFailure } from '../joinErrors.js';
import { sdk } from '../sdkClient.js';

/**
 * 게임 공통 방 연결 (ADR 0003). 만들기·입장·빠른 매칭, 입장 확인(welcome), 구독, 재접속 상태,
 * 닫힘 이유, 서버 시계 보정, 서버 거절 알림을 한 번만 구현한다. 게임은 상태 읽기와 게임 메시지만 넘긴다.
 * 재접속은 SDK 자동 재연결을 쓴다 (S-08).
 */

export type ReplaceReason = 'left' | 'disconnected' | 'returned';

/** 상대 이탈·끊김·복귀 알림 (G-37 등) */
export interface PlayerNotice {
  readonly playerId: string;
  readonly nickname: string;
  readonly reason: ReplaceReason;
  readonly at: number;
}

/** 모든 게임 화면이 받는 공통 값 */
export interface BaseSnapshot<V> {
  readonly view: V;
  readonly me: string;
  readonly role: 'player' | 'spectator';
  readonly clockOffset: number;
  readonly notice: PlayerNotice | null;
  readonly connection: 'online' | 'reconnecting';
}

export type ConnectRequest =
  | { readonly kind: 'create'; readonly options: object }
  | { readonly kind: 'join'; readonly code: string }
  | { readonly kind: 'quick' };

/** 입장을 기다리는 최대 시간. 넘으면 NETWORK */
const READY_TIMEOUT_MS = 8000;

/**
 * 방을 열고 세션을 만든다. 방 코드는 모든 게임이 같은 공간을 쓰므로(ADR 0002),
 * 코드로 들어간 방이 다른 게임이면 나오고 ROOM_NOT_FOUND로 본다
 */
export async function connectSession<T extends { ready(): Promise<T> }>(
  roomType: string,
  nickname: string,
  request: ConnectRequest,
  make: (room: Room) => T,
): Promise<T> {
  try {
    const who = { guestId: guestId(), nickname };
    let room: Room;
    if (request.kind === 'create') room = await sdk().create(roomType, { ...who, options: request.options });
    else if (request.kind === 'quick')
      room = await sdk().joinOrCreate(roomType, { ...who, options: { isPrivate: false } });
    else {
      room = await sdk().joinById(request.code, who);
      if (room.name !== roomType) {
        void room.leave(true).catch(() => undefined);
        throw new JoinError('ROOM_NOT_FOUND');
      }
    }
    return await make(room).ready();
  } catch (error) {
    throw joinFailure(error);
  }
}

interface SchemaLike {
  toJSON(): unknown;
}

export abstract class RoomSession<V extends { readonly roomCode: string }, S extends BaseSnapshot<V>> {
  #listeners = new Set<(s: S) => void>();
  #closed = new Set<(reason: string | null) => void>();
  #snapshot: S;

  /**
   * @param readView 공유 상태(schema)를 화면용 값으로 바꾼다
   * @param extra 게임별 스냅숏 필드의 처음 값
   */
  protected constructor(
    readonly room: Room,
    readView: (state: unknown) => V,
    extra: Omit<S, keyof BaseSnapshot<V>>,
  ) {
    this.#snapshot = {
      view: readView(room.state),
      me: '',
      role: 'player',
      clockOffset: 0,
      notice: null,
      connection: 'online',
      ...extra,
    } as S;
    room.reconnection.maxRetries = 30;
    room.onStateChange((state) => this.update(this.onState(readView(state as SchemaLike))));
    room.onMessage('*', (type, payload) => this.#onMessage(String(type), payload as Record<string, unknown>));
    watchReconnect(room);
    room.onDrop(() => this.update({ connection: 'reconnecting' } as Partial<S>));
    room.onReconnect(() => this.update({ connection: 'online' } as Partial<S>));
    room.onLeave((code) => {
      const reason = closeReason(code);
      for (const fn of [...this.#closed]) fn(reason);
    });
  }

  /** 새 공유 상태가 왔다. 게임은 단계가 바뀔 때 지난 판의 비공개 값을 지우는 등 패치를 더할 수 있다 */
  protected onState(view: V): Partial<S> {
    return { view } as Partial<S>;
  }

  /** 공통 메시지(welcome, turn_start, player_replaced, error) 밖의 게임 메시지 */
  protected abstract onGameMessage(type: string, payload: Record<string, unknown>): void;

  /** 서버가 요청을 거절했다. 기본은 알림을 띄운다 */
  protected onError(payload: Record<string, unknown>): void {
    toast(describeError(String(payload.code)));
  }

  get snapshot(): S {
    return this.#snapshot;
  }

  /** 주소에 쓰는 방 코드 */
  get roomCode(): string {
    return this.#snapshot.view.roomCode || this.room.roomId;
  }

  serverNow(): number {
    return Date.now() + this.#snapshot.clockOffset;
  }

  subscribe(fn: (s: S) => void): () => void {
    this.#listeners.add(fn);
    fn(this.#snapshot);
    return () => this.#listeners.delete(fn);
  }

  onClosed(fn: (reason: string | null) => void): () => void {
    this.#closed.add(fn);
    return () => this.#closed.delete(fn);
  }

  async leave(): Promise<void> {
    await this.room.leave(true).catch(() => undefined);
  }

  /** 스스로 나갈 때 닫힘 알림을 받지 않으려면 */
  protected clearClosedHandlers(): void {
    this.#closed.clear();
  }

  /** welcome을 받아 내 id가 정해지면 끝난다 */
  ready(): Promise<this> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new JoinError('NETWORK')), READY_TIMEOUT_MS);
      const check = (s: S) => {
        if (!s.me) return;
        window.clearTimeout(timer);
        this.#listeners.delete(check);
        resolve(this);
      };
      this.#listeners.add(check);
    });
  }

  protected update(patch: Partial<S>): void {
    this.#snapshot = { ...this.#snapshot, ...patch };
    for (const fn of [...this.#listeners]) fn(this.#snapshot);
  }

  #onMessage(type: string, p: Record<string, unknown>): void {
    switch (type) {
      case 'welcome':
        this.update({
          me: String(p.playerId),
          role: p.role === 'spectator' ? 'spectator' : 'player',
        } as Partial<S>);
        break;
      case 'turn_start':
        this.update({ clockOffset: Number(p.serverNow) - Date.now() } as Partial<S>);
        break;
      case 'player_replaced':
        this.update({
          notice: {
            playerId: String(p.playerId),
            nickname: String(p.nickname),
            reason: p.reason as ReplaceReason,
            at: Date.now(),
          },
        } as Partial<S>);
        break;
      case 'error':
        this.onError(p);
        break;
    }
    this.onGameMessage(type, p);
  }
}
