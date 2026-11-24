import { Room, ServerError, type Client, type Deferred } from '@colyseus/core';
import {
  CLOSE_CODES,
  MAX_PLAYERS,
  parseRoomOptions,
  type ClientMessageType,
  type ErrorCode,
  type ServerMessageType,
  type ServerMessages,
} from '@wmg/rules';
import { RateLimiter } from '../../framework/rateLimiter.js';
import { generateRoomCode, ROOM_CODES_KEY } from '../../framework/roomCode.js';
import { TimerScheduler } from '../../framework/scheduler.js';
import type { GameRecord } from '../../persistence/types.js';
import { LiarsDiceMatch, SPECTATOR_LIMIT, type MatchIO } from './LiarsDiceMatch.js';
import { activeRooms, runtime } from './runtime.js';
import type { LiarsDiceState } from './state.js';

const CLIENT_MESSAGES: readonly ClientMessageType[] = [
  'set_ready',
  'start_game',
  'bid',
  'call_liar',
  'leave_room',
  'rematch',
  'set_options',
  'add_bot',
  'remove_bot',
  'kick_player',
];
const GUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
/** 매칭/HTTP 오류 코드 (클라이언트는 message의 에러 코드 이름을 본다) */
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAVAILABLE = 503;

interface JoinInput {
  readonly guestId: string;
  readonly nickname: unknown;
}

function parseJoin(options: unknown): JoinInput {
  const raw = (typeof options === 'object' && options !== null ? options : {}) as Record<string, unknown>;
  if (typeof raw.guestId !== 'string' || !GUEST_ID_PATTERN.test(raw.guestId)) {
    throw new ServerError(HTTP_BAD_REQUEST, 'INVALID_MESSAGE');
  }
  return { guestId: raw.guestId, nickname: raw.nickname };
}

/**
 * Colyseus 방 어댑터. 게임 진행은 LiarsDiceMatch가 하고, 여기서는 연결·세션·전송만 다룬다.
 * - 공유 상태는 공개 정보뿐이다 (S-01). 주사위는 sendTo로 본인에게만 보낸다.
 * - 봇은 방 안에서 함수 호출로 움직인다 (원칙 9).
 */
export class LiarsDiceRoom extends Room<{ state: LiarsDiceState }> {
  override maxClients = MAX_PLAYERS + SPECTATOR_LIMIT;
  /** Colyseus 자체 상한 (넘으면 즉시 끊김). E-14의 초당 10회 제한은 RateLimiter가 먼저 처리한다 */
  override maxMessagesPerSecond = 40;

  #match!: LiarsDiceMatch;
  #scheduler = new TimerScheduler((error) =>
    runtime.log('error', 'room timer failed', { error: String(error) }),
  );
  #rate = new RateLimiter();
  #sessionToPlayer = new Map<string, string>();
  #playerToClient = new Map<string, Client>();
  #reconnections = new Map<string, Deferred<Client>>();
  #code = '';

  /** graceful shutdown: 대기실·결과 화면이 아니면 진행 중으로 본다 */
  get inProgress(): boolean {
    return this.#match !== undefined && !['WAITING', 'GAME_OVER'].includes(this.#match.phase);
  }

  override async onCreate(options: unknown): Promise<void> {
    if (runtime.draining) throw new ServerError(HTTP_UNAVAILABLE, 'SERVER_DRAINING');
    const raw = (typeof options === 'object' && options !== null ? options : {}) as Record<string, unknown>;
    const parsed = parseRoomOptions(raw.options);
    if (!parsed.ok) throw new ServerError(HTTP_BAD_REQUEST, 'INVALID_OPTIONS');

    const rng = runtime.createRng();
    this.#code = await generateRoomCode(
      async (code) => Boolean(await this.presence.sismember(ROOM_CODES_KEY, code)),
      rng,
    );
    await this.presence.sadd(ROOM_CODES_KEY, this.#code);
    this.roomId = this.#code;

    this.#match = new LiarsDiceMatch(this.#code, parsed.options, {
      io: this.#io,
      rng,
      scheduler: this.#scheduler,
      timing: runtime.timing,
      alonePolicy: runtime.alonePolicy,
    });
    this.setState(this.#match.state);

    activeRooms.add(this);

    for (const type of CLIENT_MESSAGES) {
      this.onMessage(type, (client: Client, payload: unknown) =>
        this.#onClientMessage(client, type, payload),
      );
    }
  }

  override onAuth(_client: Client, options: unknown): boolean {
    parseJoin(options);
    return true;
  }

  override onJoin(client: Client, options: unknown): void {
    const { guestId, nickname } = parseJoin(options);
    const result = this.#match.join(guestId, nickname);
    if (!result.ok) throw new ServerError(HTTP_BAD_REQUEST, result.code);

    if (result.reclaimed) {
      // E-13: 나중 연결을 유지하고 이전 연결을 끊는다. 재접속 대기 중이었다면 대기를 취소한다
      const previous = this.#playerToClient.get(result.playerId);
      if (previous && previous.sessionId !== client.sessionId) {
        this.#sessionToPlayer.delete(previous.sessionId);
        previous.send('error', {
          ...this.#errorPayload('DUPLICATE_SESSION', '다른 탭에서 접속해 이 연결을 닫습니다.'),
        });
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
    this.#send(client, 'welcome', { playerId: result.playerId, role: result.role });
    if (result.reclaimed) this.#match.reconnect(result.playerId);
  }

  /** S-08: 동의 없이 끊기면 60초 동안 자리를 유지한다 */
  override onDrop(client: Client): void {
    const playerId = this.#sessionToPlayer.get(client.sessionId);
    if (!playerId) return;
    this.#match.disconnect(playerId);
    const deferred = this.allowReconnection(client, runtime.reconnectSeconds);
    this.#reconnections.set(playerId, deferred);
  }

  /** S-09: 복귀하면 공유 상태 전체(Colyseus)와 본인 주사위(sendTo)를 다시 보낸다 */
  override onReconnect(client: Client): void {
    const playerId = this.#sessionToPlayer.get(client.sessionId);
    if (!playerId) return;
    this.#reconnections.delete(playerId);
    this.#playerToClient.set(playerId, client);
    this.#match.reconnect(playerId);
  }

  override onLeave(client: Client): void {
    this.#rate.forget(client.sessionId);
    const playerId = this.#sessionToPlayer.get(client.sessionId);
    // 다른 탭이 자리를 이어받았으면(E-13) 이전 세션의 퇴장은 무시한다
    if (!playerId) return;
    this.#sessionToPlayer.delete(client.sessionId);
    if (this.#playerToClient.get(playerId) === client) this.#playerToClient.delete(playerId);
    this.#reconnections.delete(playerId);
    this.#match.leave(playerId); // S-10
  }

  override async onDispose(): Promise<void> {
    activeRooms.delete(this);
    this.#match?.dispose();
    this.#scheduler.dispose();
    this.#rate.clear();
    this.#sessionToPlayer.clear();
    this.#playerToClient.clear();
    this.#reconnections.clear();
    if (this.#code) await this.presence.srem(ROOM_CODES_KEY, this.#code);
  }

  override onUnhandledMessage(client: Client): void {
    if (this.#checkRate(client))
      client.send('error', this.#errorPayload('INVALID_MESSAGE', '알 수 없는 요청입니다.'));
  }

  #onClientMessage(client: Client, type: ClientMessageType, payload: unknown): void {
    if (!this.#checkRate(client)) return;
    const playerId = this.#sessionToPlayer.get(client.sessionId);
    if (!playerId) return;
    if (type === 'leave_room') {
      client.leave();
      return;
    }
    const result = this.#match.handle(playerId, type, payload);
    if (!result.ok) client.send('error', this.#errorPayload(result.code, result.message));
  }

  /** E-14: 초과 요청은 무시하고, 반복되면 연결을 끊는다 */
  #checkRate(client: Client): boolean {
    const decision = this.#rate.hit(client.sessionId, Date.now());
    if (decision === 'allow') return true;
    if (decision === 'kick') {
      client.send('error', this.#errorPayload('RATE_LIMITED', '요청이 너무 많아 연결을 끊습니다.'));
      client.leave(CLOSE_CODES.RATE_LIMITED);
    } else if (this.#rate.isFirstDrop(client.sessionId)) {
      client.send(
        'error',
        this.#errorPayload('RATE_LIMITED', '요청이 너무 많습니다. 잠시 후 다시 시도하세요.'),
      );
    }
    return false;
  }

  #errorPayload(code: ErrorCode, message: string): ServerMessages['error'] & Record<string, unknown> {
    return { code, message, ...this.#match.envelope() };
  }

  #send<T extends ServerMessageType>(client: Client, type: T, payload: ServerMessages[T]): void {
    client.send(type, { ...payload, ...this.#match.envelope() });
  }

  // ───────── MatchIO: 게임 엔진 → 네트워크 ─────────

  readonly #io: MatchIO = {
    broadcast: (type, payload) => {
      this.broadcast(type, payload);
    },
    sendTo: (playerId, type, payload) => {
      this.#playerToClient.get(playerId)?.send(type, payload);
    },
    onRecord: (record: GameRecord) => {
      // 원칙 8, M3: 판이 끝날 때 한 번 저장. 실패해도 게임 진행은 막지 않는다
      runtime.recorder.save(record).catch((error: unknown) => {
        runtime.log('error', 'game record save failed', { gameId: record.gameId, error: String(error) });
      });
    },
    onAbandoned: () => {
      runtime.log('info', 'room abandoned (E-10)', { roomCode: this.#code });
      void this.disconnect();
    },
    onListingChange: (listed: boolean) => {
      // 랜덤 매칭은 공개·대기실·빈자리 있는 방만 찾는다. 코드(joinById)로는 계속 들어올 수 있다
      void this.setPrivate(!listed);
    },
    onKick: (playerId: string) => {
      // 매핑을 먼저 지워 onLeave가 한 번 더 처리하지 않게 한다 (엔진이 직접 퇴장 처리)
      const pending = this.#reconnections.get(playerId);
      if (pending) {
        this.#reconnections.delete(playerId);
        pending.reject(new Error('kicked by host'));
      }
      const client = this.#playerToClient.get(playerId);
      this.#playerToClient.delete(playerId);
      if (!client) return;
      this.#sessionToPlayer.delete(client.sessionId);
      client.send('error', this.#errorPayload('KICKED', '방장이 이 방에서 내보냈습니다.'));
      client.leave(CLOSE_CODES.KICKED);
    },
  };
}
