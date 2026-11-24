import { Room, ServerError, type Client, type Deferred } from '@colyseus/core';
import { CLOSE_CODES, gomoku, type ErrorCode } from '@wmg/rules';
import { RateLimiter } from '../../framework/rateLimiter.js';
import { generateRoomCode, ROOM_CODES_KEY } from '../../framework/roomCode.js';
import { TimerScheduler } from '../../framework/scheduler.js';
import { activeRooms, runtime } from '../liars-dice/runtime.js';
import { GOMOKU_SPECTATOR_LIMIT, GomokuMatch, type GomokuIO } from './GomokuMatch.js';
import { toGomokuSummary } from './record.js';
import type { GomokuState } from './state.js';

const CLIENT_MESSAGES: readonly gomoku.GomokuClientMessageType[] = [
  'set_ready',
  'start_game',
  'set_options',
  'add_bot',
  'remove_bot',
  'kick_player',
  'rematch',
  'leave_room',
  'place',
];
const GUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAVAILABLE = 503;

function parseJoin(options: unknown): { guestId: string; nickname: unknown } {
  const raw = (typeof options === 'object' && options !== null ? options : {}) as Record<string, unknown>;
  if (typeof raw.guestId !== 'string' || !GUEST_ID_PATTERN.test(raw.guestId)) {
    throw new ServerError(HTTP_BAD_REQUEST, 'INVALID_MESSAGE');
  }
  return { guestId: raw.guestId, nickname: raw.nickname };
}

/**
 * 오목 Colyseus 방 어댑터 (docs/specs/gomoku.md). 진행은 GomokuMatch가 하고 여기서는 연결·세션·전송만 다룬다.
 * 연결 끊김(G-23), 퇴장 후 봇 대체(G-22), 추방(E-15)은 거짓말쟁이 주사위 방과 같은 방식이다.
 */
export class GomokuRoom extends Room<{ state: GomokuState }> {
  override maxClients = gomoku.GOMOKU_PLAYERS + GOMOKU_SPECTATOR_LIMIT;
  override maxMessagesPerSecond = 40;

  #match!: GomokuMatch;
  #scheduler = new TimerScheduler((error) =>
    runtime.log('error', 'room timer failed', { error: String(error) }),
  );
  #rate = new RateLimiter();
  #sessionToPlayer = new Map<string, string>();
  #playerToClient = new Map<string, Client>();
  #reconnections = new Map<string, Deferred<Client>>();
  #code = '';

  get inProgress(): boolean {
    return this.#match !== undefined && !['WAITING', 'GAME_OVER'].includes(this.#match.phase);
  }

  override async onCreate(options: unknown): Promise<void> {
    if (runtime.draining) throw new ServerError(HTTP_UNAVAILABLE, 'SERVER_DRAINING');
    const raw = (typeof options === 'object' && options !== null ? options : {}) as Record<string, unknown>;
    const parsed = gomoku.parseGomokuOptions(raw.options);
    if (!parsed.ok) throw new ServerError(HTTP_BAD_REQUEST, 'INVALID_OPTIONS');

    const rng = runtime.createRng();
    this.#code = await generateRoomCode(
      async (code) => Boolean(await this.presence.sismember(ROOM_CODES_KEY, code)),
      rng,
    );
    await this.presence.sadd(ROOM_CODES_KEY, this.#code);
    this.roomId = this.#code;

    this.#match = new GomokuMatch(this.#code, parsed.options, {
      io: this.#io,
      rng,
      scheduler: this.#scheduler,
      timing: runtime.timing,
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
      const previous = this.#playerToClient.get(result.playerId);
      if (previous && previous.sessionId !== client.sessionId) {
        this.#sessionToPlayer.delete(previous.sessionId);
        previous.send(
          'error',
          this.#errorPayload('DUPLICATE_SESSION', '다른 탭에서 접속해 이 연결을 닫습니다.'),
        );
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
    if (result.reclaimed) this.#match.reconnect(result.playerId);
  }

  /** G-23: 동의 없이 끊기면 60초 동안 자리를 유지한다 (그동안 시간은 흐른다) */
  override onDrop(client: Client): void {
    const playerId = this.#sessionToPlayer.get(client.sessionId);
    if (!playerId) return;
    this.#match.disconnect(playerId);
    const deferred = this.allowReconnection(client, runtime.reconnectSeconds);
    this.#reconnections.set(playerId, deferred);
  }

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
    if (!playerId) return;
    this.#sessionToPlayer.delete(client.sessionId);
    if (this.#playerToClient.get(playerId) === client) this.#playerToClient.delete(playerId);
    this.#reconnections.delete(playerId);
    this.#match.leave(playerId); // G-22
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

  #onClientMessage(client: Client, type: gomoku.GomokuClientMessageType, payload: unknown): void {
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

  #errorPayload(code: ErrorCode, message: string): { code: string; message: string } {
    return { code, message };
  }

  readonly #io: GomokuIO = {
    broadcast: (type, payload) => this.broadcast(type, payload),
    sendTo: (playerId, type, payload) => {
      this.#playerToClient.get(playerId)?.send(type, payload);
    },
    onAbandoned: () => {
      runtime.log('info', 'room abandoned (GE-06)', { roomCode: this.#code, game: gomoku.GOMOKU_ROOM_TYPE });
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
      client.send('error', this.#errorPayload('KICKED', '방장이 이 방에서 내보냈습니다.'));
      client.leave(CLOSE_CODES.KICKED);
    },
    onFinished: (record) => {
      runtime.log('info', 'gomoku game finished', {
        roomCode: record.roomCode,
        result: record.result,
        winner: record.winnerColor,
        moves: record.moves.length,
      });
      // 판 요약만 저장한다 (ADR 0002). 저장소는 실패해도 던지지 않고 재시도한다
      void runtime.recorder.saveSummary(toGomokuSummary(record));
    },
  };
}
