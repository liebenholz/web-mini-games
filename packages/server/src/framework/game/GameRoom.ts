import { Room, ServerError, type Client, type Deferred } from '@colyseus/core';
import { CLOSE_CODES, GUEST_ID_PATTERN, type ErrorCode } from '@wmg/rules';
import { activeRooms, runtime } from '../../games/liars-dice/runtime.js';
import { RateLimiter } from '../rateLimiter.js';
import type { Rng } from '../rng.js';
import { generateRoomCode, ROOM_CODES_KEY } from '../roomCode.js';
import { TimerScheduler } from '../scheduler.js';
import type { JoinResult, HandleResult, LobbyIO } from './LobbyMatch.js';

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAVAILABLE = 503;

/** 공통 대기실 메시지 (ADR 0003). 게임은 여기에 게임 메시지만 더한다 */
export const LOBBY_MESSAGES = [
  'set_ready',
  'start_game',
  'set_options',
  'add_bot',
  'remove_bot',
  'kick_player',
  'rematch',
  'leave_room',
] as const;

/** 방이 진행에 바라는 것. LobbyMatch가 만족한다 */
export interface MatchLike {
  readonly state: object;
  readonly phase: string;
  join(guestId: string, nickname: unknown): JoinResult;
  disconnect(playerId: string): void;
  reconnect(playerId: string): void;
  leave(playerId: string): void;
  handle(playerId: string, type: string, payload: unknown): HandleResult;
  dispose(): void;
}

/** 방 → 진행: 메시지 전송과 대기실 공통 알림 */
export interface RoomIO extends LobbyIO {
  broadcast(type: string, payload: unknown): void;
  sendTo(playerId: string, type: string, payload: unknown): void;
}

function parseJoin(options: unknown): { guestId: string; nickname: unknown } {
  const raw = (typeof options === 'object' && options !== null ? options : {}) as Record<string, unknown>;
  if (typeof raw.guestId !== 'string' || !GUEST_ID_PATTERN.test(raw.guestId)) {
    throw new ServerError(HTTP_BAD_REQUEST, 'INVALID_MESSAGE');
  }
  return { guestId: raw.guestId, nickname: raw.nickname };
}

/**
 * 게임 공통 Colyseus 방 (ADR 0003). 진행은 MatchLike가 하고, 여기서는 연결·세션·전송만 다룬다.
 * 방 코드(presence), 빈도 제한(E-14), 같은 게스트 두 탭(E-13), 재접속 대기(S-08),
 * 추방(E-15), 목록 공개, 모두 나감 기록(ST-09), dispose 정리를 한 번만 구현한다.
 */
export abstract class GameRoom<M extends MatchLike, O> extends Room<{ state: M['state'] }> {
  override maxMessagesPerSecond = 40;

  protected match!: M;
  protected readonly scheduler = new TimerScheduler((error) =>
    runtime.log('error', 'room timer failed', { error: String(error) }),
  );
  #rate = new RateLimiter();
  #sessionToPlayer = new Map<string, string>();
  #playerToClient = new Map<string, Client>();
  #reconnections = new Map<string, Deferred<Client>>();
  protected code = '';

  /** 이 방이 받는 게임 메시지 (대기실 메시지는 LOBBY_MESSAGES) */
  protected abstract readonly gameMessages: readonly string[];
  /** 방을 만들 때 받은 options를 검증한다. 틀리면 null (INVALID_OPTIONS) */
  protected abstract parseOptions(rawOptions: unknown): O | null;
  /** 방 코드가 정해진 뒤 진행을 만든다 */
  protected abstract createMatch(code: string, options: O, rng: Rng): M;

  get inProgress(): boolean {
    return this.match !== undefined && !['WAITING', 'GAME_OVER'].includes(this.match.phase);
  }

  override async onCreate(options: unknown): Promise<void> {
    if (runtime.draining) throw new ServerError(HTTP_UNAVAILABLE, 'SERVER_DRAINING');
    const raw = (typeof options === 'object' && options !== null ? options : {}) as Record<string, unknown>;
    const parsed = this.parseOptions(raw.options);
    if (parsed === null) throw new ServerError(HTTP_BAD_REQUEST, 'INVALID_OPTIONS');

    const rng = runtime.createRng();
    this.code = await generateRoomCode(
      async (code) => Boolean(await this.presence.sismember(ROOM_CODES_KEY, code)),
      rng,
    );
    await this.presence.sadd(ROOM_CODES_KEY, this.code);
    this.roomId = this.code;

    this.match = this.createMatch(this.code, parsed, rng);
    this.setState(this.match.state);
    activeRooms.add(this);

    for (const type of [...LOBBY_MESSAGES, ...this.gameMessages]) {
      this.onMessage(type, (client: Client, payload: unknown) => this.#onClientMessage(client, type, payload));
    }
  }

  override onAuth(_client: Client, options: unknown): boolean {
    parseJoin(options);
    return true;
  }

  override onJoin(client: Client, options: unknown): void {
    const { guestId, nickname } = parseJoin(options);
    const result = this.match.join(guestId, nickname);
    if (!result.ok) throw new ServerError(HTTP_BAD_REQUEST, result.code);

    if (result.reclaimed) {
      const previous = this.#playerToClient.get(result.playerId);
      if (previous && previous.sessionId !== client.sessionId) {
        this.#sessionToPlayer.delete(previous.sessionId);
        previous.send('error', this.errorPayload('DUPLICATE_SESSION', '다른 탭에서 접속해 이 연결을 닫습니다.'));
        previous.leave(CLOSE_CODES.DUPLICATE_SESSION);
      }
      const pending = this.#reconnections.get(result.playerId);
      if (pending) {
        this.#reconnections.delete(result.playerId);
        pending.reject(new Error('superseded by a new session'));
      }
    }

    this.#sessionToPlayer.set(client.sessionId, result.playerId);
    this.#playerToClient.set(result.playerId, client);
    client.send('welcome', { playerId: result.playerId, role: result.role });
    if (result.reclaimed) this.match.reconnect(result.playerId);
  }

  /** S-08: 동의 없이 끊기면 정해진 시간 동안 자리를 유지한다 */
  override onDrop(client: Client): void {
    const playerId = this.#sessionToPlayer.get(client.sessionId);
    if (!playerId) return;
    this.match.disconnect(playerId);
    const deferred = this.allowReconnection(client, runtime.reconnectSeconds);
    this.#reconnections.set(playerId, deferred);
  }

  override onReconnect(client: Client): void {
    const playerId = this.#sessionToPlayer.get(client.sessionId);
    if (!playerId) return;
    this.#reconnections.delete(playerId);
    this.#playerToClient.set(playerId, client);
    this.match.reconnect(playerId);
  }

  override onLeave(client: Client): void {
    this.#rate.forget(client.sessionId);
    const playerId = this.#sessionToPlayer.get(client.sessionId);
    if (!playerId) return;
    this.#sessionToPlayer.delete(client.sessionId);
    if (this.#playerToClient.get(playerId) === client) this.#playerToClient.delete(playerId);
    this.#reconnections.delete(playerId);
    this.match.leave(playerId);
  }

  override async onDispose(): Promise<void> {
    activeRooms.delete(this);
    this.match?.dispose();
    this.scheduler.dispose();
    this.#rate.clear();
    this.#sessionToPlayer.clear();
    this.#playerToClient.clear();
    this.#reconnections.clear();
    if (this.code) await this.presence.srem(ROOM_CODES_KEY, this.code);
  }

  override onUnhandledMessage(client: Client): void {
    if (this.#checkRate(client))
      client.send('error', this.errorPayload('INVALID_MESSAGE', '알 수 없는 요청입니다.'));
  }

  #onClientMessage(client: Client, type: string, payload: unknown): void {
    if (!this.#checkRate(client)) return;
    const playerId = this.#sessionToPlayer.get(client.sessionId);
    if (!playerId) return;
    if (type === 'leave_room') {
      client.leave();
      return;
    }
    const result = this.match.handle(playerId, type, payload);
    if (!result.ok) client.send('error', this.errorPayload(result.code, result.message));
  }

  /** E-14: 초과 요청은 무시하고, 반복되면 연결을 끊는다 */
  #checkRate(client: Client): boolean {
    const decision = this.#rate.hit(client.sessionId, Date.now());
    if (decision === 'allow') return true;
    if (decision === 'kick') {
      client.send('error', this.errorPayload('RATE_LIMITED', '요청이 너무 많아 연결을 끊습니다.'));
      client.leave(CLOSE_CODES.RATE_LIMITED);
    } else if (this.#rate.isFirstDrop(client.sessionId)) {
      client.send('error', this.errorPayload('RATE_LIMITED', '요청이 너무 많습니다. 잠시 후 다시 시도하세요.'));
    }
    return false;
  }

  protected errorPayload(code: ErrorCode, message: string): Record<string, unknown> {
    return { code, message };
  }

  protected readonly io: RoomIO = {
    broadcast: (type, payload) => this.broadcast(type, payload),
    sendTo: (playerId, type, payload) => {
      this.#playerToClient.get(playerId)?.send(type, payload);
    },
    onAbandoned: () => {
      // ST-09: 기록 없이 끝난 판은 개수만 남긴다. 저장소가 실패를 삼킨다
      void runtime.recorder.abandoned(this.roomName, new Date());
      runtime.log('info', 'room abandoned (E-10)', { roomCode: this.code, game: this.roomName });
      void this.disconnect();
    },
    onListingChange: (listed: boolean) => {
      void this.setPrivate(!listed);
    },
    onKick: (playerId: string) => {
      const pending = this.#reconnections.get(playerId);
      if (pending) {
        this.#reconnections.delete(playerId);
        pending.reject(new Error('kicked by host'));
      }
      const client = this.#playerToClient.get(playerId);
      this.#playerToClient.delete(playerId);
      if (!client) return;
      this.#sessionToPlayer.delete(client.sessionId);
      client.send('error', this.errorPayload('KICKED', '방장이 이 방에서 내보냈습니다.'));
      client.leave(CLOSE_CODES.KICKED);
    },
  };
}
