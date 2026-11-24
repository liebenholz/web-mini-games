import { Client, type Room } from '@colyseus/sdk';
import {
  GAME_ID,
  type ClientMessageType,
  type ClientMessages,
  type DieFace,
  type ErrorCode,
  type GamePhase,
  type RoomOptions,
  type ServerMessages,
} from '@wmg/rules';
import { SERVER_URL } from './config.js';
import { guestId } from './identity.js';

/** 공유 상태(공개 정보)를 평범한 객체로 옮긴 것. 서버 state.ts와 같은 모양이다 */
export interface PlayerView {
  id: string;
  nickname: string;
  seat: number;
  isBot: boolean;
  isHost: boolean;
  ready: boolean;
  connected: boolean;
  autopilot: boolean;
  spectator: boolean;
  diceCount: number;
  eliminated: boolean;
  rank: number;
}

export interface BidView {
  playerId: string;
  quantity: number;
  face: number;
  isAuto: boolean;
}

export interface RoomView {
  phase: GamePhase;
  roomCode: string;
  hostId: string;
  options: RoomOptions;
  players: PlayerView[];
  roundNo: number;
  totalDice: number;
  currentTurn: string;
  turnId: string;
  deadline: number;
  phaseEndsAt: number;
  bids: BidView[];
}

export type RevealView = ServerMessages['reveal'] & { roundNo: number };

export interface SessionSnapshot {
  view: RoomView;
  me: string;
  role: 'player' | 'spectator';
  myDice: readonly DieFace[];
  /** 서버 시간 − 내 시간 (S-05: 타이머 표시용) */
  clockOffset: number;
  reveal: RevealView | null;
  ranking: ServerMessages['game_over']['ranking'] | null;
  connection: 'online' | 'reconnecting';
}

export class JoinError extends Error {
  constructor(readonly code: ErrorCode | 'NETWORK') {
    super(code);
  }
}

/** 서버가 보낸 거부 메시지를 사용자 문구로 */
export function describeError(code: string): string {
  const map: Record<string, string> = {
    ROOM_NOT_FOUND: '방을 찾을 수 없습니다. 코드를 다시 확인해 주세요.',
    ROOM_FULL: '방이 가득 찼습니다.',
    INVALID_NICKNAME: '닉네임은 2~12자로 입력해 주세요.',
    INVALID_OPTIONS: '방 옵션이 올바르지 않습니다.',
    SERVER_DRAINING: '서버 점검 중입니다. 잠시 후 다시 시도해 주세요.',
    DUPLICATE_SESSION: '다른 탭에서 같은 계정으로 접속해 이 화면을 닫았습니다.',
    RATE_LIMITED: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
    NETWORK: '서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.',
  };
  return map[code] ?? '요청을 처리하지 못했습니다.';
}

function toJoinError(error: unknown): JoinError {
  const message = error instanceof Error ? error.message : String(error);
  const known = [
    'ROOM_FULL',
    'INVALID_NICKNAME',
    'INVALID_OPTIONS',
    'INVALID_MESSAGE',
    'SERVER_DRAINING',
  ] as const;
  for (const code of known) if (message.includes(code)) return new JoinError(code);
  const code = (error as { code?: number }).code;
  if (code === 404 || code === 4212 || /not found|invalid room|room .* not/i.test(message))
    return new JoinError('ROOM_NOT_FOUND');
  return new JoinError('NETWORK');
}

interface SchemaLike {
  toJSON(): unknown;
}

function readView(state: SchemaLike): RoomView {
  const raw = state.toJSON() as Omit<RoomView, 'players'> & { players: Record<string, PlayerView> };
  return { ...raw, players: Object.values(raw.players ?? {}), bids: raw.bids ?? [] };
}

type Listener = (s: SessionSnapshot) => void;
type EventListener = (type: keyof ServerMessages, payload: unknown) => void;

/**
 * 방 하나와의 연결. 공유 상태 + 본인에게만 오는 메시지(your_dice 등)를 합쳐 화면에 넘긴다.
 * 재접속은 SDK 자동 재연결(S-08)을 쓰고, 페이지를 새로 열면 같은 게스트 ID로 다시 들어가 자리를 되찾는다(E-13).
 */
export class Session {
  #listeners = new Set<Listener>();
  #events = new Set<EventListener>();
  #snapshot: SessionSnapshot;
  #closedHandlers = new Set<(reason: string | null) => void>();

  private constructor(readonly room: Room) {
    this.#snapshot = {
      view: readView(room.state as SchemaLike),
      me: '',
      role: 'player',
      myDice: [],
      clockOffset: 0,
      reveal: null,
      ranking: null,
      connection: 'online',
    };
    room.reconnection.maxRetries = 30;
    room.onStateChange((state) => {
      const view = readView(state as SchemaLike);
      // 새 라운드가 시작되면 지난 공개 결과와 내 주사위를 비운다
      const roundChanged = view.roundNo !== this.#snapshot.view.roundNo;
      const toWaiting = view.phase === 'WAITING' && this.#snapshot.view.phase !== 'WAITING';
      this.#update({
        view,
        ...(roundChanged || toWaiting ? { reveal: null } : {}),
        ...(toWaiting ? { ranking: null, myDice: [] } : {}),
        ...(view.phase === 'RESOLVE' || toWaiting ? { myDice: [] } : {}),
      });
    });
    room.onMessage('*', (type, payload) => this.#onMessage(type as keyof ServerMessages, payload));
    room.onDrop(() => this.#update({ connection: 'reconnecting' }));
    room.onReconnect(() => this.#update({ connection: 'online' }));
    room.onLeave((code) => {
      // 4001/4002는 서버가 정한 종료 코드 (rules CLOSE_CODES). 그 밖의 비정상 종료는 재연결 실패로 본다
      const reason =
        code === 4001
          ? 'DUPLICATE_SESSION'
          : code === 4002
            ? 'RATE_LIMITED'
            : code === 1000
              ? null
              : 'NETWORK';
      for (const h of this.#closedHandlers) h(reason);
    });
  }

  static async create(nickname: string, options: Partial<RoomOptions>): Promise<Session> {
    try {
      const room = await sdk().create(GAME_ID, { guestId: guestId(), nickname, options });
      return await new Session(room).#ready();
    } catch (error) {
      throw error instanceof JoinError ? error : toJoinError(error);
    }
  }

  static async join(code: string, nickname: string): Promise<Session> {
    try {
      const room = await sdk().joinById(code, { guestId: guestId(), nickname });
      // 방 코드는 모든 게임이 같은 공간을 쓴다. 초대 링크의 게임과 다른 방이면 들어가지 않는다 (ADR 0002)
      if (room.name !== GAME_ID) {
        void room.leave(true).catch(() => undefined);
        throw new JoinError('ROOM_NOT_FOUND');
      }
      return await new Session(room).#ready();
    } catch (error) {
      throw error instanceof JoinError ? error : toJoinError(error);
    }
  }

  /** 랜덤 매칭: 공개 대기실이 있으면 들어가고 없으면 공개 방을 만든다 */
  static async quickMatch(nickname: string): Promise<Session> {
    try {
      const room = await sdk().joinOrCreate(GAME_ID, {
        guestId: guestId(),
        nickname,
        options: { isPrivate: false },
      });
      return await new Session(room).#ready();
    } catch (error) {
      throw error instanceof JoinError ? error : toJoinError(error);
    }
  }

  #ready(): Promise<Session> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new JoinError('NETWORK')), 8000);
      const check = () => {
        if (this.#snapshot.me) {
          window.clearTimeout(timer);
          this.#listeners.delete(check);
          resolve(this);
        }
      };
      this.#listeners.add(check);
    });
  }

  get snapshot(): SessionSnapshot {
    return this.#snapshot;
  }

  subscribe(fn: Listener): () => void {
    this.#listeners.add(fn);
    fn(this.#snapshot);
    return () => this.#listeners.delete(fn);
  }

  onEvent(fn: EventListener): () => void {
    this.#events.add(fn);
    return () => this.#events.delete(fn);
  }

  onClosed(fn: (reason: string | null) => void): () => void {
    this.#closedHandlers.add(fn);
    return () => this.#closedHandlers.delete(fn);
  }

  send<T extends ClientMessageType>(type: T, payload: ClientMessages[T]): void {
    this.room.send(type, payload);
  }

  async leave(): Promise<void> {
    this.#closedHandlers.clear();
    await this.room.leave(true).catch(() => undefined);
  }

  serverNow(): number {
    return Date.now() + this.#snapshot.clockOffset;
  }

  #onMessage(type: keyof ServerMessages, payload: unknown): void {
    const p = payload as Record<string, unknown>;
    switch (type) {
      case 'welcome':
        this.#update({ me: String(p.playerId), role: p.role === 'spectator' ? 'spectator' : 'player' });
        break;
      case 'your_dice':
        this.#update({ myDice: (p.dice as DieFace[]) ?? [] });
        break;
      case 'turn_start':
        this.#update({ clockOffset: Number(p.serverNow) - Date.now() });
        break;
      case 'reveal':
        this.#update({ reveal: p as unknown as RevealView });
        break;
      case 'game_over':
        this.#update({ ranking: (p as unknown as ServerMessages['game_over']).ranking });
        break;
      default:
        break;
    }
    for (const fn of this.#events) fn(type, payload);
  }

  #update(patch: Partial<SessionSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch };
    for (const fn of [...this.#listeners]) fn(this.#snapshot);
  }
}

let client: Client | null = null;
function sdk(): Client {
  client ??= new Client(SERVER_URL);
  return client;
}
