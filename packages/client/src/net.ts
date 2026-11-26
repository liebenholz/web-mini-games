import type { Room } from '@colyseus/sdk';
import {
  GAME_ID,
  type ClientMessageType,
  type ClientMessages,
  type DieFace,
  type GamePhase,
  type RoomOptions,
  type ServerMessages,
} from '@wmg/rules';
import { connectSession, RoomSession, type BaseSnapshot } from './games/roomSession.js';

export { closeReason, describeError, JoinError, joinFailure, toJoinError } from './joinErrors.js';
export { sdk } from './sdkClient.js';

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

export interface SessionSnapshot extends BaseSnapshot<RoomView> {
  readonly myDice: readonly DieFace[];
  readonly reveal: RevealView | null;
  readonly ranking: ServerMessages['game_over']['ranking'] | null;
}

interface SchemaLike {
  toJSON(): unknown;
}

function readView(state: SchemaLike): RoomView {
  const raw = state.toJSON() as Omit<RoomView, 'players'> & { players: Record<string, PlayerView> };
  return { ...raw, players: Object.values(raw.players ?? {}), bids: raw.bids ?? [] };
}

type EventListener = (type: keyof ServerMessages, payload: unknown) => void;

/**
 * 거짓말쟁이 주사위 방 하나와의 연결. 연결 공통 부분은 RoomSession (ADR 0003).
 * 화면(Phaser 테이블, 선언 패널)이 모든 서버 메시지를 순서대로 받도록 onEvent를 더 둔다
 */
export class Session extends RoomSession<RoomView, SessionSnapshot> {
  #events = new Set<EventListener>();

  private constructor(room: Room) {
    super(room, (state) => readView(state as SchemaLike), { myDice: [], reveal: null, ranking: null });
  }

  static create(nickname: string, options: Partial<RoomOptions>): Promise<Session> {
    return connectSession(GAME_ID, nickname, { kind: 'create', options }, (r) => new Session(r));
  }

  static join(code: string, nickname: string): Promise<Session> {
    return connectSession(GAME_ID, nickname, { kind: 'join', code }, (r) => new Session(r));
  }

  /** 랜덤 매칭: 공개 대기실이 있으면 들어가고 없으면 공개 방을 만든다 */
  static quickMatch(nickname: string): Promise<Session> {
    return connectSession(GAME_ID, nickname, { kind: 'quick' }, (r) => new Session(r));
  }

  onEvent(fn: EventListener): () => void {
    this.#events.add(fn);
    return () => this.#events.delete(fn);
  }

  send<T extends ClientMessageType>(type: T, payload: ClientMessages[T]): void {
    this.room.send(type, payload);
  }

  /** 스스로 나가면 닫힘 알림을 보내지 않는다 */
  override async leave(): Promise<void> {
    this.clearClosedHandlers();
    await super.leave();
  }

  /** 새 라운드가 시작되면 지난 공개 결과와 내 주사위를 비운다 */
  protected override onState(view: RoomView): Partial<SessionSnapshot> {
    const before = this.snapshot.view;
    const roundChanged = view.roundNo !== before.roundNo;
    const toWaiting = view.phase === 'WAITING' && before.phase !== 'WAITING';
    return {
      view,
      ...(roundChanged || toWaiting ? { reveal: null } : {}),
      ...(toWaiting ? { ranking: null, myDice: [] } : {}),
      ...(view.phase === 'RESOLVE' || toWaiting ? { myDice: [] } : {}),
    };
  }

  /** 거절 알림은 화면이 onEvent로 받아 보여 준다 */
  protected override onError(): void {}

  protected onGameMessage(type: string, p: Record<string, unknown>): void {
    switch (type) {
      case 'your_dice':
        this.update({ myDice: (p.dice as DieFace[]) ?? [] });
        break;
      case 'reveal':
        this.update({ reveal: p as unknown as RevealView });
        break;
      case 'game_over':
        this.update({ ranking: (p as unknown as ServerMessages['game_over']).ranking });
        break;
    }
    for (const fn of this.#events) fn(type as keyof ServerMessages, p);
  }
}
