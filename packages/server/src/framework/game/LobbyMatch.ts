import { normalizeNickname, type ErrorCode } from '@wmg/rules';
import type { Timing } from '../../games/liars-dice/LiarsDiceMatch.js';
import type { Rng } from '../rng.js';
import type { Scheduler } from '../scheduler.js';

/**
 * 게임 공통 대기실과 좌석 (ADR 0003). 입장·퇴장·재접속, 준비, 방장, 옵션, 봇, 추방, 시작 조건,
 * 게임 중 퇴장과 봇 대체(S-10, G-22), 이탈 기록(ST-08), 리매치, 모두 나감(E-10), 턴 타이머를 한 번만 구현한다.
 * 게임은 이 클래스를 상속해 시작, 게임 메시지, 봇, 끝을 구현한다. 네트워크는 모른다 (VirtualScheduler로 테스트).
 */

export type JoinResult =
  | {
      readonly ok: true;
      readonly playerId: string;
      readonly role: 'player' | 'spectator';
      readonly reclaimed: boolean;
    }
  | { readonly ok: false; readonly code: ErrorCode };

export type HandleResult =
  { readonly ok: true } | { readonly ok: false; readonly code: ErrorCode; readonly message: string };

export const OK: HandleResult = { ok: true };
export const fail = (code: ErrorCode, message: string): HandleResult => ({ ok: false, code, message });

export type ReplaceReason = 'left' | 'disconnected' | 'returned';

/** 엔진 → 네트워크 공통 부분. 방 어댑터(GameRoom)가 구현한다 */
export interface LobbyIO {
  /** 사람이 모두 나갔다. 방을 닫는다 (기록하지 않음) */
  onAbandoned(): void;
  onListingChange(listed: boolean): void;
  /** 방장이 이 참가자를 내보냈다. 연결을 KICKED로 닫는다 */
  onKick(playerId: string): void;
}

/** 공통 대기실 메시지에 필요한 옵션 */
export interface LobbyOptions {
  readonly fillWithBots: boolean;
  readonly isPrivate: boolean;
}

/** 구성원의 공개 상태(schema)에서 대기실이 쓰는 필드 */
export interface LobbyPlayerView {
  isBot: boolean;
  isHost: boolean;
  ready: boolean;
  connected: boolean;
  spectator: boolean;
}

/** 공유 상태(schema)에서 대기실이 쓰는 필드 */
export interface LobbyState<V> {
  phase: string;
  roomCode: string;
  hostId: string;
  phaseEndsAt: number;
  readonly players: { set(key: string, value: V): unknown; delete(key: string): unknown };
}

export interface LobbyMember<V> {
  readonly id: string;
  readonly guestId: string | null;
  readonly nickname: string;
  readonly joinOrder: number;
  readonly originallyBot: boolean;
  /** 지금 이 자리를 누가 두는가 */
  controller: 'human' | 'bot';
  /** 사람이 방 안에 있거나 재접속 대기 중 */
  present: boolean;
  spectator: boolean;
  ready: boolean;
  readonly view: V;
}

export interface LobbyDeps<IO> {
  readonly io: IO;
  readonly rng: Rng;
  readonly scheduler: Scheduler;
  readonly timing: Timing;
}

export interface NewView {
  readonly id: string;
  readonly nickname: string;
  readonly isBot: boolean;
  readonly ready: boolean;
  readonly spectator: boolean;
  readonly connected: boolean;
}

export abstract class LobbyMatch<
  O extends LobbyOptions,
  V extends LobbyPlayerView,
  M extends LobbyMember<V>,
  S extends LobbyState<V>,
  IO extends LobbyIO,
> {
  readonly state: S;
  protected readonly io: IO;
  protected readonly rng: Rng;
  protected readonly scheduler: Scheduler;
  protected readonly timing: Timing;
  protected opts: O;
  protected readonly members = new Map<string, M>();
  protected readonly byGuest = new Map<string, string>();
  protected readonly kicked = new Set<string>();
  /** ST-08: 이번 판에서 봇이 자리를 이어받은 사람 (돌아와도 남긴다) */
  protected readonly replacedIds = new Set<string>();
  protected disposed = false;
  #cancelTurn: (() => void) | null = null;
  #cancelBot: (() => void) | null = null;
  #cancelPhase: (() => void) | null = null;
  #joinCounter = 0;
  #botCounter = 0;
  #listed = false;

  protected constructor(state: S, roomCode: string, options: O, deps: LobbyDeps<IO>) {
    this.state = state;
    this.io = deps.io;
    this.rng = deps.rng;
    this.scheduler = deps.scheduler;
    this.timing = deps.timing;
    this.opts = options;
    this.state.roomCode = roomCode;
  }

  // ───────────── 게임이 구현하는 부분 ─────────────

  /** 앉을 수 있는 자리 수 (대기실 정원, 빈자리 봇 채우기 목표) */
  protected abstract maxSeats(): number;
  /** 게임 중 관전자 정원 */
  protected abstract spectatorLimit(): number;
  /** 새 구성원의 공개 상태 */
  protected abstract createView(init: NewView): V;
  /** 새 구성원의 게임별 필드 */
  protected abstract createMember(base: LobbyMember<V>): M;
  /** set_options: 부분 옵션을 지금 옵션 위에 덮어써 검증한다 */
  protected abstract parseOptions(input: unknown): { ok: true; options: O } | { ok: false };
  /** 옵션을 공유 상태에 쓴다 */
  protected abstract writeOptions(): void;
  /** 시작 카운트다운이 끝났다: 좌석을 정하고 첫 차례를 연다 */
  protected abstract beginGame(): void;
  /** 대기실 공통 메시지가 아닌 게임 메시지 */
  protected abstract handleGame(m: M, type: string, body: Record<string, unknown>): HandleResult;
  /** 복귀한 사람에게 본인 정보와 현재 차례를 다시 보낸다 */
  abstract resendPrivate(playerId: string): void;
  /** 판이 끝나 대기실로 돌아갈 때 구성원의 게임 필드를 지운다 */
  protected abstract resetMemberForRematch(m: M): void;
  /** 판이 끝나 대기실로 돌아갈 때 게임 상태를 지운다 */
  protected abstract resetGameForRematch(): void;
  /** 게임 중 사람이 나가 봇이 자리를 이어받았다. 지금 그 사람 차례면 봇을 예약하는 등 */
  protected abstract onSeatTakenOver(m: M): void;
  /** 상대에게 이탈·끊김·복귀를 알린다 */
  protected abstract notifyReplaced(m: M, reason: ReplaceReason): void;
  /** 판이 진행 중인 단계 (끊김 알림, 모두 나감 판단) */
  protected abstract isPlaying(): boolean;
  /** 판이 끝난 단계 */
  protected abstract isGameOver(): boolean;

  /** 시작에 필요한 최소 인원 */
  protected minPlayers(): number {
    return 2;
  }

  // ───────────── 상태 ─────────────

  get phase(): string {
    return this.state.phase;
  }

  get options(): O {
    return this.opts;
  }

  protected setPhase(phase: string): void {
    this.state.phase = phase;
  }

  // ───────────── 입장 / 퇴장 ─────────────

  join(guestId: string, rawNickname: unknown): JoinResult {
    if (this.kicked.has(guestId)) return { ok: false, code: 'KICKED' };
    const existingId = this.byGuest.get(guestId);
    const existing = existingId ? this.members.get(existingId) : undefined;
    if (existing && existing.present) {
      existing.view.connected = true;
      return {
        ok: true,
        playerId: existing.id,
        role: existing.spectator ? 'spectator' : 'player',
        reclaimed: true,
      };
    }
    const nickname = normalizeNickname(rawNickname);
    if (nickname === null) return { ok: false, code: 'INVALID_NICKNAME' };

    let spectator = false;
    if (this.phase === 'WAITING') {
      if (this.seated().length >= this.maxSeats()) return { ok: false, code: 'ROOM_FULL' };
    } else {
      // 게임 중 입장은 관전자 (E-11, GE-07, BE-06, CE-09)
      if (this.spectators().length >= this.spectatorLimit()) return { ok: false, code: 'ROOM_FULL' };
      spectator = true;
    }
    const member = this.addMember({ guestId, nickname, bot: false, spectator });
    if (!this.state.hostId) this.setHost(member);
    this.updateListing();
    return { ok: true, playerId: member.id, role: spectator ? 'spectator' : 'player', reclaimed: false };
  }

  /** 연결 끊김. 자리는 유지하고 상대에게 알린다 */
  disconnect(playerId: string): void {
    const m = this.members.get(playerId);
    if (!m) return;
    m.view.connected = false;
    if (this.isPlaying() && !m.spectator) this.notifyReplaced(m, 'disconnected');
  }

  reconnect(playerId: string): void {
    const m = this.members.get(playerId);
    if (!m || !m.present) return;
    const wasOff = !m.view.connected;
    m.view.connected = true;
    if (wasOff && this.isPlaying() && !m.spectator) this.notifyReplaced(m, 'returned');
    this.resendPrivate(playerId);
  }

  /** 사람이 방을 떠났다 (스스로 나감 또는 재접속 시간 초과). 게임 중이면 봇이 이어받는다 */
  leave(playerId: string): void {
    const m = this.members.get(playerId);
    if (!m || m.controller === 'bot') return;
    if (m.guestId) this.byGuest.delete(m.guestId);

    if (m.spectator || this.phase === 'WAITING') {
      this.removeMember(m);
    } else if (this.isGameOver()) {
      m.present = false;
      m.view.connected = false;
    } else {
      m.present = false;
      if (!m.originallyBot) this.replacedIds.add(m.id);
      m.controller = 'bot';
      m.view.isBot = true;
      m.view.connected = true;
      this.onSeatTakenOver(m);
    }

    if (this.state.hostId === m.id) {
      m.view.isHost = false;
      this.state.hostId = '';
      const next = this.earliestHuman();
      if (next) this.setHost(next);
    }
    this.updateListing();
    this.checkAbandoned();
  }

  // ───────────── 메시지 ─────────────

  handle(playerId: string, type: string, payload: unknown): HandleResult {
    const m = this.members.get(playerId);
    if (!m || this.disposed) return fail('INVALID_STATE', '방에 참가하고 있지 않습니다.');
    const body = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
    switch (type) {
      case 'set_ready':
        return this.setReady(m, body);
      case 'set_options':
        return this.setOptions(m, body);
      case 'add_bot':
        return this.addBot(m);
      case 'remove_bot':
        return this.removeBot(m, body);
      case 'kick_player':
        return this.kickPlayer(m, body);
      case 'start_game':
        return this.startGame(m);
      case 'rematch':
        return this.rematch(m);
      default:
        return this.handleGame(m, type, body);
    }
  }

  protected setReady(m: M, body: Record<string, unknown>): HandleResult {
    if (this.phase !== 'WAITING') return fail('INVALID_STATE', '대기실에서만 준비할 수 있습니다.');
    if (typeof body.ready !== 'boolean') return fail('INVALID_MESSAGE', '잘못된 요청입니다.');
    if (m.spectator) return fail('INVALID_STATE', '관전자는 준비할 수 없습니다.');
    m.ready = body.ready;
    m.view.ready = body.ready;
    return OK;
  }

  protected setOptions(m: M, body: Record<string, unknown>): HandleResult {
    if (this.phase !== 'WAITING') return fail('INVALID_STATE', '대기실에서만 옵션을 바꿀 수 있습니다.');
    if (this.state.hostId !== m.id) return fail('NOT_HOST', '방장만 옵션을 바꿀 수 있습니다.');
    const parsed = this.parseOptions(body.options);
    if (!parsed.ok) return fail('INVALID_OPTIONS', '옵션 값이 올바르지 않습니다.');
    this.opts = parsed.options;
    this.writeOptions();
    this.updateListing();
    return OK;
  }

  protected addBot(m: M): HandleResult {
    if (this.phase !== 'WAITING') return fail('INVALID_STATE', '대기실에서만 봇을 추가할 수 있습니다.');
    if (this.state.hostId !== m.id) return fail('NOT_HOST', '방장만 봇을 추가할 수 있습니다.');
    if (this.seated().length >= this.maxSeats()) return fail('ROOM_FULL', '자리가 없습니다.');
    this.addBotMember();
    this.updateListing();
    return OK;
  }

  protected removeBot(m: M, body: Record<string, unknown>): HandleResult {
    if (this.phase !== 'WAITING') return fail('INVALID_STATE', '대기실에서만 봇을 뺄 수 있습니다.');
    if (this.state.hostId !== m.id) return fail('NOT_HOST', '방장만 봇을 뺄 수 있습니다.');
    const target = typeof body.playerId === 'string' ? this.members.get(body.playerId) : undefined;
    if (!target || !target.originallyBot) return fail('INVALID_MESSAGE', '봇을 찾을 수 없습니다.');
    this.removeMember(target);
    this.updateListing();
    return OK;
  }

  /** E-15: 방장만, 대기실에서, 사람만. 같은 게스트 ID는 이 방에 다시 못 들어온다 */
  protected kickPlayer(m: M, body: Record<string, unknown>): HandleResult {
    if (this.phase !== 'WAITING') return fail('INVALID_STATE', '대기실에서만 내보낼 수 있습니다.');
    if (this.state.hostId !== m.id) return fail('NOT_HOST', '방장만 내보낼 수 있습니다.');
    const target = typeof body.playerId === 'string' ? this.members.get(body.playerId) : undefined;
    if (!target || target.originallyBot || target.id === m.id)
      return fail('INVALID_MESSAGE', '내보낼 참가자를 찾을 수 없습니다.');
    if (target.guestId) this.kicked.add(target.guestId);
    this.io.onKick(target.id);
    this.leave(target.id);
    return OK;
  }

  /** 시작 조건: 방장, 전원 준비, 최소 인원. 빈자리 봇 채우기가 켜져 있으면 정원까지 채운다 */
  protected startGame(m: M): HandleResult {
    if (this.phase !== 'WAITING') return fail('INVALID_STATE', '이미 시작했습니다.');
    if (this.state.hostId !== m.id) return fail('NOT_HOST', '방장만 시작할 수 있습니다.');
    const seated = this.seated();
    if (seated.some((x) => x.controller === 'human' && !x.ready && x.id !== m.id))
      return fail('NOT_ALL_READY', '모두 준비해야 시작할 수 있습니다.');
    const min = this.minPlayers();
    if (seated.length < min && !this.opts.fillWithBots) {
      const need = min === this.maxSeats() ? `${min}명이 필요합니다.` : `${min}명 이상이 필요합니다.`;
      return fail('NOT_ENOUGH_PLAYERS', need);
    }
    if (this.opts.fillWithBots) while (this.seated().length < this.maxSeats()) this.addBotMember();
    this.setPhase('STARTING');
    this.updateListing();
    this.state.phaseEndsAt = this.scheduler.now() + this.timing.startCountdownMs;
    this.#cancelPhase = this.scheduler.after(this.timing.startCountdownMs, () => {
      this.#cancelPhase = null;
      this.beginGame();
    });
    return OK;
  }

  /** 같은 방 대기실로. 나간 사람(봇이 이어받은 자리)은 정리하고, 정원을 넘는 자리는 관전자로 돌린다 */
  protected rematch(m: M): HandleResult {
    if (!this.isGameOver()) return fail('INVALID_STATE', '게임이 끝난 뒤에만 다시 할 수 있습니다.');
    if (!m.present) return fail('INVALID_STATE', '방에 없습니다.');
    for (const x of [...this.members.values()]) {
      if (!x.originallyBot && !x.present) {
        this.removeMember(x);
        continue;
      }
      this.resetMemberForRematch(x);
      x.spectator = false;
      x.view.spectator = false;
      if (x.controller === 'human') {
        x.ready = x.id === this.state.hostId;
        x.view.ready = x.ready;
      }
    }
    const seated = this.seated().sort(
      (a, b) => Number(a.originallyBot) - Number(b.originallyBot) || a.joinOrder - b.joinOrder,
    );
    seated.slice(this.maxSeats()).forEach((x) => {
      if (x.originallyBot) this.removeMember(x);
      else {
        x.spectator = true;
        x.view.spectator = true;
      }
    });
    this.resetGameForRematch();
    this.setPhase('WAITING');
    this.updateListing();
    return OK;
  }

  // ───────────── 타이머 (원칙 7: 마감 시각 하나에 거는 단발 타이머) ─────────────

  /** 턴 마감 타이머. 새로 걸면 이전 것은 취소한다 */
  protected setTurnTimer(delayMs: number, fn: () => void): void {
    this.#cancelTurn?.();
    this.#cancelTurn = this.scheduler.after(delayMs, () => {
      this.#cancelTurn = null;
      fn();
    });
  }

  /** 봇 행동 타이머 (1~3초 지연, S-12). 새로 걸면 이전 것은 취소한다 */
  protected setBotTimer(fn: () => void): void {
    this.#cancelBot?.();
    const span = Math.max(0, this.timing.botDelayMaxMs - this.timing.botDelayMinMs);
    const delay = this.timing.botDelayMinMs + (span > 0 ? this.rng.int(span + 1) : 0);
    this.#cancelBot = this.scheduler.after(delay, () => {
      this.#cancelBot = null;
      fn();
    });
  }

  protected clearTurnTimers(): void {
    this.#cancelTurn?.();
    this.#cancelBot?.();
    this.#cancelTurn = null;
    this.#cancelBot = null;
  }

  // ───────────── 정리 ─────────────

  /** E-10: 사람이 모두 나가면 방 종료, 기록하지 않음 */
  protected checkAbandoned(): void {
    const humans = [...this.members.values()].filter((m) => m.present && m.controller !== 'bot');
    const seatedHumans = humans.filter((m) => !m.spectator);
    if (
      humans.length === 0 ||
      (this.phase !== 'WAITING' && !this.isGameOver() && seatedHumans.length === 0)
    ) {
      this.dispose();
      this.io.onAbandoned();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTurnTimers();
    this.#cancelPhase?.();
    this.#cancelPhase = null;
  }

  // ───────────── 구성원 ─────────────

  protected seated(): M[] {
    return [...this.members.values()].filter((m) => !m.spectator);
  }

  protected spectators(): M[] {
    return [...this.members.values()].filter((m) => m.spectator);
  }

  protected earliestHuman(): M | undefined {
    return [...this.members.values()]
      .filter((m) => m.present && m.controller !== 'bot')
      .sort((a, b) => Number(a.spectator) - Number(b.spectator) || a.joinOrder - b.joinOrder)[0];
  }

  protected setHost(m: M): void {
    this.state.hostId = m.id;
    m.view.isHost = true;
    m.ready = true;
    m.view.ready = true;
  }

  #publicId(prefix: string): string {
    for (;;) {
      const id = `${prefix}${this.rng.id().replace(/-/g, '').slice(0, 12)}`;
      if (!this.members.has(id)) return id;
    }
  }

  protected addMember(input: {
    guestId: string | null;
    nickname: string;
    bot: boolean;
    spectator: boolean;
  }): M {
    const id = this.#publicId(input.bot ? 'b_' : 'p_');
    const view = this.createView({
      id,
      nickname: input.nickname,
      isBot: input.bot,
      ready: input.bot,
      spectator: input.spectator,
      connected: true,
    });
    const member = this.createMember({
      id,
      guestId: input.guestId,
      nickname: input.nickname,
      joinOrder: (this.#joinCounter += 1),
      originallyBot: input.bot,
      controller: input.bot ? 'bot' : 'human',
      present: !input.bot,
      spectator: input.spectator,
      ready: input.bot,
      view,
    });
    this.members.set(id, member);
    if (input.guestId) this.byGuest.set(input.guestId, id);
    this.state.players.set(id, view);
    return member;
  }

  protected addBotMember(): M {
    const used = new Set([...this.members.values()].map((m) => m.nickname));
    let name: string;
    do {
      this.#botCounter += 1;
      name = `봇 ${this.#botCounter}`;
    } while (used.has(name));
    return this.addMember({ guestId: null, nickname: name, bot: true, spectator: false });
  }

  protected removeMember(m: M): void {
    this.members.delete(m.id);
    if (m.guestId && this.byGuest.get(m.guestId) === m.id) this.byGuest.delete(m.guestId);
    this.state.players.delete(m.id);
  }

  /** 공개 방이고, 대기실이고, 자리가 남았을 때만 랜덤 매칭 목록에 보인다 */
  protected updateListing(): void {
    const listed = !this.opts.isPrivate && this.phase === 'WAITING' && this.seated().length < this.maxSeats();
    if (listed !== this.#listed) {
      this.#listed = listed;
      this.io.onListingChange(listed);
    }
  }
}
