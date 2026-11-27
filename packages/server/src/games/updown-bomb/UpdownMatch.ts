import { updown } from '@wmg/rules';
import {
  fail,
  LobbyMatch,
  OK,
  type HandleResult,
  type LobbyIO,
  type LobbyMember,
  type NewView,
  type ReplaceReason,
} from '../../framework/game/LobbyMatch.js';
import type { Rng } from '../../framework/rng.js';
import type { Scheduler } from '../../framework/scheduler.js';
import type { Timing } from '../liars-dice/LiarsDiceMatch.js';
import { UpdownCallState, UpdownPlayerState, UpdownState } from './state.js';

export type { HandleResult, JoinResult } from '../../framework/game/LobbyMatch.js';

type Options = updown.UpdownRoomOptions;
type ServerMessages = updown.UpdownServerMessages;
type ServerMessageType = updown.UpdownServerMessageType;
type Phase = updown.UpdownPhase;

export const UPDOWN_SPECTATOR_LIMIT = 20;
/** UD-13: 봇은 1~2초 뒤에 말한다 (공통 기본값은 최대 3초) */
const BOT_DELAY_SPAN_MS = 1000;
const ROLL_SCALE = 1_000_000;

/** 엔진 → 네트워크. 방 어댑터(UpdownRoom)가 구현한다 */
export interface UpdownIO extends LobbyIO {
  broadcast<T extends ServerMessageType>(type: T, payload: ServerMessages[T]): void;
  sendTo<T extends ServerMessageType>(playerId: string, type: T, payload: ServerMessages[T]): void;
  onFinished?(record: UpdownRecord): void;
}

export interface UpdownRecord {
  readonly gameId: string;
  readonly roomCode: string;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly options: Options;
  readonly players: readonly {
    readonly playerId: string;
    readonly guestId: string | null;
    readonly nickname: string;
    readonly seat: number;
    readonly isBot: boolean;
    readonly replaced: boolean;
  }[];
  readonly calls: readonly {
    readonly seat: number;
    readonly value: number;
    readonly result: updown.CallResult;
    readonly isBot: boolean;
    readonly isAuto: boolean;
  }[];
  readonly bomb: number;
  readonly loserSeat: number;
  readonly forced: boolean;
}

export interface UpdownDeps {
  readonly io: UpdownIO;
  readonly rng: Rng;
  readonly scheduler: Scheduler;
  readonly timing: Timing;
}

interface Member extends LobbyMember<UpdownPlayerState> {
  seat: number;
  /** UD-12: 이어진 시간 초과 수 */
  consecutiveTimeouts: number;
}

/**
 * 업다운 숫자폭탄 한 방의 진행 (docs/specs/updown-bomb.md). 대기실·좌석·이탈·리매치는 LobbyMatch(ADR 0003)가 하고,
 * 여기서는 폭탄 뽑기, 말하기, 마지막 한 숫자, 시간 초과 대신 말하기, 봇, 판 기록만 다룬다.
 */
export class UpdownMatch extends LobbyMatch<Options, UpdownPlayerState, Member, UpdownState, UpdownIO> {
  #game: updown.UpdownState | null = null;
  #bySeat = new Map<number, Member>();
  #flags: { isBot: boolean; isAuto: boolean }[] = [];
  #gameId = '';
  #startedAt = new Date(0);
  #turnId = '';

  constructor(roomCode: string, options: Options, deps: UpdownDeps) {
    super(new UpdownState(), roomCode, options, deps);
    this.writeOptions();
    this.#clear();
    this.updateListing();
  }

  override get phase(): Phase {
    return this.state.phase as Phase;
  }

  // ───────────────────────── 대기실 훅 ─────────────────────────

  protected maxSeats(): number {
    return this.opts.maxPlayers;
  }

  protected spectatorLimit(): number {
    return UPDOWN_SPECTATOR_LIMIT;
  }

  protected override notEnoughPlayersMessage(): string {
    return '2명 이상이 필요합니다.';
  }

  /** 지금 앉은 인원보다 정원을 줄일 수 없다 */
  protected override checkOptions(next: Options): string | null {
    return next.maxPlayers < this.seated().length ? '지금 인원보다 적게 줄일 수 없습니다.' : null;
  }

  /** 리매치는 앉아 있던 사람(봇 포함) 먼저, 그다음 들어온 순서 */
  protected override rematchOrder(a: Member, b: Member): number {
    return Number(a.spectator) - Number(b.spectator) || a.joinOrder - b.joinOrder;
  }

  protected createView(init: NewView): UpdownPlayerState {
    return new UpdownPlayerState({ ...init });
  }

  protected createMember(base: LobbyMember<UpdownPlayerState>): Member {
    return { ...base, seat: -1, consecutiveTimeouts: 0 };
  }

  protected parseOptions(input: unknown): { ok: true; options: Options } | { ok: false } {
    return updown.parseUpdownOptions(input, this.opts);
  }

  protected writeOptions(): void {
    const o = this.state.options;
    const v = this.opts;
    o.rangeMax = v.rangeMax;
    o.maxPlayers = v.maxPlayers;
    o.turnSeconds = v.turnSeconds;
    o.fillWithBots = v.fillWithBots;
    o.isPrivate = v.isPrivate;
    if (this.phase === 'WAITING') {
      this.state.low = 1;
      this.state.high = v.rangeMax;
    }
  }

  protected isPlaying(): boolean {
    return this.phase === 'PLAYING';
  }

  protected isGameOver(): boolean {
    return this.phase === 'GAME_OVER';
  }

  protected override botDelay(): number {
    const { botDelayMinMs: min, botDelayMaxMs: max } = this.timing;
    const span = Math.max(0, Math.min(max - min, BOT_DELAY_SPAN_MS));
    return min + (span > 0 ? this.rng.int(span + 1) : 0);
  }

  protected notifyReplaced(m: Member, reason: ReplaceReason): void {
    this.io.broadcast('player_replaced', { playerId: m.id, nickname: m.nickname, reason });
  }

  /** 공통: 게임 중 나가면 봇이 이어서 하고, 다른 사람에게 알린다 */
  protected onSeatTakenOver(m: Member): void {
    m.view.replaced = true;
    m.view.autopilot = false;
    this.notifyReplaced(m, 'left');
    if (this.phase === 'PLAYING' && this.#game?.turn === m.seat) this.#scheduleBot(this.#turnId);
  }

  resendPrivate(playerId: string): void {
    if (this.phase !== 'PLAYING' || !this.state.currentTurn) return;
    this.io.sendTo(playerId, 'turn_start', {
      playerId: this.state.currentTurn,
      turnId: this.#turnId,
      deadline: this.state.deadline,
      serverNow: this.scheduler.now(),
    });
  }

  protected handleGame(m: Member, type: string, body: Record<string, unknown>): HandleResult {
    if (type === 'call_number') return this.#call(m, body);
    return fail('INVALID_MESSAGE', '알 수 없는 요청입니다.');
  }

  protected resetMemberForRematch(x: Member): void {
    x.seat = -1;
    x.consecutiveTimeouts = 0;
    x.view.seat = -1;
    x.view.autopilot = false;
  }

  /** UD-08: 같은 방 대기실로 */
  protected resetGameForRematch(): void {
    this.#clear();
  }

  // ───────────────────────── 진행 ─────────────────────────

  /** UD-01, UD-02: 좌석은 들어온 순서, 폭탄과 첫 차례는 무작위 */
  protected beginGame(): void {
    const seated = this.seated().sort((a, b) => a.joinOrder - b.joinOrder);
    this.#bySeat.clear();
    seated.forEach((p, seat) => {
      p.seat = seat;
      p.consecutiveTimeouts = 0;
      Object.assign(p.view, { seat, autopilot: false });
      this.#bySeat.set(seat, p);
    });
    const range = { low: 1, high: this.opts.rangeMax };
    const bomb = range.low + this.rng.int(range.high - range.low + 1);
    this.#game = updown.createUpdown(range, seated.length, bomb, this.rng.int(seated.length));
    this.#flags = [];
    this.#gameId = this.rng.id();
    this.#startedAt = new Date(this.scheduler.now());
    this.replacedIds.clear();
    this.state.low = range.low;
    this.state.high = range.high;
    this.state.history.clear();
    this.state.loserId = '';
    this.state.bomb = 0;
    this.state.forced = false;
    this.state.phaseEndsAt = 0;
    this.setPhase('PLAYING');
    this.#startTurn();
  }

  #clear(): void {
    this.#game = null;
    this.#flags = [];
    this.state.low = 1;
    this.state.high = this.opts.rangeMax;
    this.state.history.clear();
    this.state.currentTurn = '';
    this.state.turnId = '';
    this.state.deadline = 0;
    this.state.loserId = '';
    this.state.bomb = 0;
    this.state.forced = false;
  }

  #startTurn(): void {
    this.clearTurnTimers();
    const g = this.#game;
    if (!g) return;
    const player = this.#bySeat.get(g.turn);
    if (!player) return;
    this.#turnId = this.rng.id();
    const deadline = this.scheduler.now() + this.opts.turnSeconds * this.timing.msPerTurnSecond;
    this.state.currentTurn = player.id;
    this.state.turnId = this.#turnId;
    this.state.deadline = deadline;
    this.io.broadcast('turn_start', {
      playerId: player.id,
      turnId: this.#turnId,
      deadline,
      serverNow: this.scheduler.now(),
    });
    const turnId = this.#turnId;
    // UD-12: 마감까지 말하지 않으면 대신 말한다. 끊겨 있어도 같다 (UD-11). 봇 자리는 시간 초과가 없다 (UD-14)
    this.setTurnTimer(deadline - this.scheduler.now(), () => this.#onTimeout(turnId));
    if (player.controller !== 'human') this.#scheduleBot(turnId);
  }

  #onTimeout(turnId: string): void {
    const g = this.#game;
    if (!g || this.phase !== 'PLAYING' || this.#turnId !== turnId) return;
    const m = this.#bySeat.get(g.turn);
    if (!m || m.controller !== 'human') return;
    m.consecutiveTimeouts += 1;
    if (m.consecutiveTimeouts >= 2) {
      m.controller = 'autopilot';
      m.view.autopilot = true;
    }
    this.#autoCall(m, true);
  }

  #scheduleBot(turnId: string): void {
    this.setBotTimer(() => {
      const g = this.#game;
      if (!g || this.phase !== 'PLAYING' || this.#turnId !== turnId) return;
      const m = this.#bySeat.get(g.turn);
      if (!m || m.controller === 'human') return;
      this.#autoCall(m, m.controller === 'autopilot');
    });
  }

  /** UD-12, UD-13: 범위 안에서 무작위로 말한다 */
  #autoCall(m: Member, isAuto: boolean): void {
    const g = this.#game;
    if (!g) return;
    const value = updown.updownPick(g, this.rng.int(ROLL_SCALE) / ROLL_SCALE);
    const r = updown.callNumber(g, m.seat, value);
    if (r.ok) this.#apply(m, r, { isBot: m.controller === 'bot', isAuto });
  }

  /** UD-03, 10장 예외 */
  #call(m: Member, body: Record<string, unknown>): HandleResult {
    const g = this.#game;
    if (!g || this.phase !== 'PLAYING') return fail('INVALID_STATE', '게임 중이 아닙니다.');
    if (m.spectator || m.seat < 0 || g.turn !== m.seat || m.controller === 'bot')
      return fail('NOT_YOUR_TURN', '내 차례가 아닙니다.');
    if (body.turnId !== this.#turnId) return fail('STALE_TURN', '이미 지난 차례입니다.');
    const r = updown.callNumber(g, m.seat, body.value);
    if (!r.ok) {
      return r.code === 'OUT_OF_RANGE'
        ? fail('OUT_OF_RANGE', `${g.low}~${g.high} 사이 숫자만 말할 수 있습니다.`)
        : fail('NOT_YOUR_TURN', '내 차례가 아닙니다.');
    }
    // UD-12: 직접 말하면 돌려받는다
    m.consecutiveTimeouts = 0;
    if (m.controller === 'autopilot') {
      m.controller = 'human';
      m.view.autopilot = false;
    }
    this.#apply(m, r, { isBot: false, isAuto: false });
    return OK;
  }

  #apply(
    m: Member,
    r: { readonly state: updown.UpdownState; readonly result: updown.CallResult },
    how: { readonly isBot: boolean; readonly isAuto: boolean },
  ): void {
    this.clearTurnTimers();
    this.#game = r.state;
    this.#flags.push(how);
    const last = r.state.calls[r.state.calls.length - 1];
    if (!last) return;
    this.state.low = r.state.low;
    this.state.high = r.state.high;
    this.state.history.push(
      new UpdownCallState({ playerId: m.id, value: last.value, result: last.result, isAuto: how.isAuto }),
    );
    this.io.broadcast('number_called', {
      playerId: m.id,
      value: last.value,
      result: last.result,
      low: r.state.low,
      high: r.state.high,
      ...how,
    });
    if (r.state.loser !== null) {
      this.#finish();
      return;
    }
    this.#startTurn();
  }

  /** UD-06, UD-07, UD-22 */
  #finish(): void {
    const g = this.#game;
    if (!g || g.loser === null) return;
    this.clearTurnTimers();
    const loser = this.#bySeat.get(g.loser);
    this.state.loserId = loser?.id ?? '';
    this.state.bomb = g.bomb;
    this.state.forced = g.forced;
    this.state.currentTurn = '';
    this.state.turnId = '';
    this.state.deadline = 0;
    this.setPhase('GAME_OVER');
    this.io.broadcast('game_over', { loserId: loser?.id ?? '', bomb: g.bomb, forced: g.forced });
    this.io.onFinished?.({
      gameId: this.#gameId,
      roomCode: this.state.roomCode,
      startedAt: this.#startedAt,
      endedAt: new Date(this.scheduler.now()),
      options: this.opts,
      players: [...this.#bySeat.values()].map((p) => ({
        playerId: p.id,
        guestId: p.guestId,
        nickname: p.nickname,
        seat: p.seat,
        isBot: p.originallyBot,
        replaced: this.replacedIds.has(p.id),
      })),
      calls: g.calls.map((c, i) => ({
        ...c,
        isBot: this.#flags[i]?.isBot ?? false,
        isAuto: this.#flags[i]?.isAuto ?? false,
      })),
      bomb: g.bomb,
      loserSeat: g.loser,
      forced: g.forced,
    });
  }
}
