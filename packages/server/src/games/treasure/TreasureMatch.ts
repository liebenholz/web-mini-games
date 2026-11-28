import { treasure } from '@wmg/rules';
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
import { TreasurePickState, TreasurePlayerState, TreasureState } from './state.js';

export type { HandleResult, JoinResult } from '../../framework/game/LobbyMatch.js';

type Options = treasure.TreasureRoomOptions;
type ServerMessages = treasure.TreasureServerMessages;
type ServerMessageType = treasure.TreasureServerMessageType;
type Phase = treasure.TreasurePhase;

export const TREASURE_SPECTATOR_LIMIT = 20;
/** BH-13: 봇은 1~2초 뒤에 고르고 바로 확정한다 (공통 기본값은 최대 3초) */
const BOT_DELAY_SPAN_MS = 1000;
const ROLL_SCALE = 1_000_000;

/** 엔진 → 네트워크. 방 어댑터(TreasureRoom)가 구현한다 */
export interface TreasureIO extends LobbyIO {
  broadcast<T extends ServerMessageType>(type: T, payload: ServerMessages[T]): void;
  sendTo<T extends ServerMessageType>(playerId: string, type: T, payload: ServerMessages[T]): void;
  onFinished?(record: TreasureRecord): void;
}

export interface TreasureRecord {
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
  /** 동점 재대결 횟수 */
  readonly replays: number;
  /** 시간 초과로 서버가 대신 무작위로 고른 칸 수 (모든 단계 합) */
  readonly autoPicks: number;
  readonly lastMaxSq: number;
  readonly tieBreak: boolean;
  readonly loserSeat: number;
}

export interface TreasureDeps {
  readonly io: TreasureIO;
  readonly rng: Rng;
  readonly scheduler: Scheduler;
  readonly timing: Timing;
}

interface Member extends LobbyMember<TreasurePlayerState> {
  seat: number;
  /** BH-12: 이어진 "못 골라서 대신 고른" 횟수 */
  consecutiveTimeouts: number;
}

interface PickEntry {
  x: number;
  y: number;
  locked: boolean;
  isAuto: boolean;
}

/**
 * 보물 찾기 한 방의 진행 (docs/specs/treasure.md). 대기실·좌석·이탈·리매치는 LobbyMatch(ADR 0003)가 하고,
 * 여기서는 보물 뽑기, 동시 선택·확정, 공개, 동점 재대결, 시간 초과·봇, 판 기록만 다룬다.
 */
export class TreasureMatch extends LobbyMatch<
  Options,
  TreasurePlayerState,
  Member,
  TreasureState,
  TreasureIO
> {
  #bySeat = new Map<number, Member>();
  /** 이번 선택 단계 참가자의 좌석 */
  #participants: number[] = [];
  #picks = new Map<number, PickEntry>();
  #treasure: treasure.Cell = { x: 0, y: 0 };
  #roundId = '';
  #replays = 0;
  #autoPicks = 0;
  #lastMaxSq = 0;
  #tieBreak = false;
  #loserSeat = -1;
  #gameId = '';
  #startedAt = new Date(0);

  constructor(roomCode: string, options: Options, deps: TreasureDeps) {
    super(new TreasureState(), roomCode, options, deps);
    this.writeOptions();
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
    return TREASURE_SPECTATOR_LIMIT;
  }

  protected override notEnoughPlayersMessage(): string {
    return '2명 이상이 필요합니다.';
  }

  /** 지금 앉은 인원보다 정원을 줄일 수 없다 */
  protected override checkOptions(next: Options): string | null {
    return next.maxPlayers < this.seated().length ? '지금 인원보다 적게 줄일 수 없습니다.' : null;
  }

  protected override rematchOrder(a: Member, b: Member): number {
    return Number(a.spectator) - Number(b.spectator) || a.joinOrder - b.joinOrder;
  }

  protected createView(init: NewView): TreasurePlayerState {
    return new TreasurePlayerState({ ...init });
  }

  protected createMember(base: LobbyMember<TreasurePlayerState>): Member {
    return { ...base, seat: -1, consecutiveTimeouts: 0 };
  }

  protected parseOptions(input: unknown): { ok: true; options: Options } | { ok: false } {
    return treasure.parseTreasureOptions(input, this.opts);
  }

  protected writeOptions(): void {
    const o = this.state.options;
    const v = this.opts;
    o.maxPlayers = v.maxPlayers;
    o.pickSeconds = v.pickSeconds;
    o.fillWithBots = v.fillWithBots;
    o.isPrivate = v.isPrivate;
  }

  protected isPlaying(): boolean {
    return this.phase === 'PICKING' || this.phase === 'REVEAL';
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

  /** 공통: 게임 중 나가면 봇이 이어서 한다. 이미 확정한 선택은 그대로 둔다 (BH-11) */
  protected onSeatTakenOver(m: Member): void {
    m.view.replaced = true;
    m.view.autopilot = false;
    this.notifyReplaced(m, 'left');
    if (this.phase === 'PICKING') this.#scheduleBots();
  }

  /** 복귀하면 내 선택을 다시 보낸다 (BH-21) */
  resendPrivate(playerId: string): void {
    const m = this.members.get(playerId);
    if (!m || this.phase !== 'PICKING' || m.seat < 0) return;
    const p = this.#picks.get(m.seat);
    if (p)
      this.io.sendTo(playerId, 'your_pick', { roundId: this.#roundId, x: p.x, y: p.y, locked: p.locked });
  }

  protected handleGame(m: Member, type: string, body: Record<string, unknown>): HandleResult {
    if (type === 'pick') return this.#pick(m, body);
    if (type === 'lock_pick') return this.#lock(m, body);
    return fail('INVALID_MESSAGE', '알 수 없는 요청입니다.');
  }

  protected resetMemberForRematch(x: Member): void {
    x.seat = -1;
    x.consecutiveTimeouts = 0;
    Object.assign(x.view, { seat: -1, locked: false, inRound: false, autopilot: false });
  }

  /** BH-08: 같은 방 대기실로 */
  protected resetGameForRematch(): void {
    this.#clearRound();
    this.state.hasReveal = false;
    this.state.loserId = '';
    this.state.tieBreak = false;
    this.state.replay = 0;
    this.state.roundId = '';
    this.state.deadline = 0;
  }

  // ───────────────────────── 진행 ─────────────────────────

  /** BH-01: 좌석은 들어온 순서. 첫 선택 단계를 시작한다 */
  protected beginGame(): void {
    const seated = this.seated().sort((a, b) => a.joinOrder - b.joinOrder);
    this.#bySeat.clear();
    seated.forEach((p, seat) => {
      p.seat = seat;
      p.consecutiveTimeouts = 0;
      Object.assign(p.view, { seat, locked: false, inRound: true, autopilot: false });
      this.#bySeat.set(seat, p);
    });
    this.#replays = 0;
    this.#autoPicks = 0;
    this.#tieBreak = false;
    this.#loserSeat = -1;
    this.#gameId = this.rng.id();
    this.#startedAt = new Date(this.scheduler.now());
    this.replacedIds.clear();
    this.state.phaseEndsAt = 0;
    this.state.hasReveal = false;
    this.state.loserId = '';
    this.state.tieBreak = false;
    this.#startRound(seated.map((p) => p.seat));
  }

  #clearRound(): void {
    this.clearTurnTimers();
    this.clearPhaseTimer();
    this.#participants = [];
    this.#picks = new Map();
  }

  /** 선택 단계를 시작한다 (처음 또는 동점 재대결). 보물을 새로 뽑는다 (BH-01, BH-07) */
  #startRound(seats: number[]): void {
    this.#clearRound();
    this.#participants = seats;
    this.#treasure = treasure.cellOf(this.rng.int(treasure.GRID_CELLS));
    this.#roundId = this.rng.id();
    const deadline = this.scheduler.now() + this.opts.pickSeconds * this.timing.msPerTurnSecond;
    for (const m of this.#bySeat.values()) {
      const inRound = seats.includes(m.seat);
      m.view.inRound = inRound;
      m.view.locked = false;
    }
    this.state.roundId = this.#roundId;
    this.state.replay = this.#replays;
    this.state.deadline = deadline;
    this.state.hasReveal = false;
    this.state.reveal.picks.clear();
    this.state.reveal.far = '';
    this.state.reveal.tie = false;
    this.setPhase('PICKING');
    this.io.broadcast('round_start', {
      roundId: this.#roundId,
      participants: seats.flatMap((s) => {
        const id = this.#bySeat.get(s)?.id;
        return id ? [id] : [];
      }),
      deadline,
      serverNow: this.scheduler.now(),
      replay: this.#replays,
    });
    // BH-10, BH-12: 마감 하나. 마감까지 확정하지 않은 사람은 그 시점의 선택으로 확정한다
    this.setTurnTimer(deadline - this.scheduler.now(), () => this.#onDeadline(this.#roundId));
    this.#scheduleBots();
  }

  /** BH-13: 봇이 맡은 자리는 1~2초 뒤 무작위 칸을 골라 바로 확정한다 */
  #scheduleBots(): void {
    const roundId = this.#roundId;
    this.setBotTimer(() => {
      if (this.phase !== 'PICKING' || this.#roundId !== roundId) return;
      for (const seat of this.#participants) {
        const m = this.#bySeat.get(seat);
        if (!m || m.controller === 'human') continue;
        const entry = this.#picks.get(seat);
        if (entry?.locked) continue;
        // 사람이 나가기 전에 골라 둔 칸이 있으면 그대로 확정한다 (BH-11)
        const c = entry ?? treasure.randomCell(this.rng.int(ROLL_SCALE) / ROLL_SCALE);
        // 자동 진행(autopilot)은 서버가 대신 고르는 것이라 isAuto, 봇은 아니다
        this.#picks.set(seat, {
          x: c.x,
          y: c.y,
          locked: false,
          isAuto: entry ? entry.isAuto : m.controller === 'autopilot',
        });
        this.#lockSeat(m);
        if (this.phase !== 'PICKING' || this.#roundId !== roundId) return;
      }
    });
  }

  /** BH-02: 마감 전에는 바꿀 수 있다 */
  #pick(m: Member, body: Record<string, unknown>): HandleResult {
    const guard = this.#guard(m, body);
    if (guard) return guard;
    if (!treasure.inGrid(body.x, body.y)) return fail('INVALID_MOVE', '판 안의 칸을 골라 주세요.');
    const entry = this.#picks.get(m.seat);
    if (entry?.locked) return fail('INVALID_STATE', '이미 확정했습니다.');
    // BH-12: 직접 고르면 돌려받는다
    this.#giveBack(m);
    this.#picks.set(m.seat, { x: body.x as number, y: body.y as number, locked: false, isAuto: false });
    this.io.sendTo(m.id, 'your_pick', {
      roundId: this.#roundId,
      x: body.x as number,
      y: body.y as number,
      locked: false,
    });
    return OK;
  }

  /** BH-03: 확정하면 잠기고, 모두 확정하면 마감을 기다리지 않고 공개한다 */
  #lock(m: Member, body: Record<string, unknown>): HandleResult {
    const guard = this.#guard(m, body);
    if (guard) return guard;
    const entry = this.#picks.get(m.seat);
    if (!entry) return fail('INVALID_MOVE', '먼저 칸을 골라 주세요.');
    if (entry.locked) return fail('INVALID_STATE', '이미 확정했습니다.');
    this.#giveBack(m);
    this.#lockSeat(m);
    return OK;
  }

  #guard(m: Member, body: Record<string, unknown>): HandleResult | null {
    if (this.phase !== 'PICKING') return fail('INVALID_STATE', '선택 단계가 아닙니다.');
    if (m.spectator || m.seat < 0 || !this.#participants.includes(m.seat) || m.controller === 'bot')
      return fail('NOT_YOUR_TURN', '이번 선택에 참가하지 않았습니다.');
    if (body.roundId !== this.#roundId) return fail('STALE_TURN', '이미 지난 단계입니다.');
    return null;
  }

  #giveBack(m: Member): void {
    m.consecutiveTimeouts = 0;
    if (m.controller === 'autopilot') {
      m.controller = 'human';
      m.view.autopilot = false;
    }
  }

  #lockSeat(m: Member): void {
    const entry = this.#picks.get(m.seat);
    if (!entry || entry.locked) return;
    entry.locked = true;
    m.view.locked = true;
    this.io.sendTo(m.id, 'your_pick', { roundId: this.#roundId, x: entry.x, y: entry.y, locked: true });
    this.io.broadcast('pick_locked', { playerId: m.id });
    if (this.#participants.every((s) => this.#picks.get(s)?.locked)) this.#reveal();
  }

  /** BH-12: 마감 */
  #onDeadline(roundId: string): void {
    if (this.phase !== 'PICKING' || this.#roundId !== roundId) return;
    for (const seat of this.#participants) {
      const m = this.#bySeat.get(seat);
      const entry = this.#picks.get(seat);
      if (!m || entry?.locked) continue;
      if (!entry) {
        // 못 골랐다: 무작위 칸을 대신 고른다. 사람이 이러면 연속 횟수를 센다
        const c = treasure.randomCell(this.rng.int(ROLL_SCALE) / ROLL_SCALE);
        this.#picks.set(seat, { x: c.x, y: c.y, locked: false, isAuto: true });
        if (m.controller === 'human') {
          m.consecutiveTimeouts += 1;
          if (m.consecutiveTimeouts >= 2) {
            m.controller = 'autopilot';
            m.view.autopilot = true;
          }
        }
      }
      // 골라 둔 칸은 그대로 확정한다
      this.#lockSeat(m);
      if (this.phase !== 'PICKING' || this.#roundId !== roundId) return;
    }
    // 아무도 남지 않았는데 reveal이 안 됐다면 (참가자가 비어 있는 경우) 공개한다
    if (this.phase === 'PICKING' && this.#roundId === roundId) this.#reveal();
  }

  /** BH-04: 보물과 모든 선택을 한꺼번에 공개한다 */
  #reveal(): void {
    if (this.phase !== 'PICKING') return;
    this.clearTurnTimers();
    const picks = this.#participants.flatMap((seat) => {
      const e = this.#picks.get(seat);
      return e ? [{ seat, x: e.x, y: e.y }] : [];
    });
    if (picks.length === 0) return;
    const result = treasure.resolveRound(this.#treasure, picks);
    this.#lastMaxSq = result.maxSq;
    this.#autoPicks += result.ranked.filter((r) => this.#picks.get(r.seat)?.isAuto).length;
    const idOf = (seat: number) => this.#bySeat.get(seat)?.id ?? '';
    const revealed = result.ranked.map((r) => ({
      playerId: idOf(r.seat),
      x: r.x,
      y: r.y,
      distSq: r.distSq,
      isAuto: this.#picks.get(r.seat)?.isAuto ?? false,
    }));
    const tie = result.far.length > 1;
    this.state.reveal.treasureX = this.#treasure.x;
    this.state.reveal.treasureY = this.#treasure.y;
    this.state.reveal.picks.clear();
    for (const p of revealed) this.state.reveal.picks.push(new TreasurePickState(p));
    this.state.reveal.far = result.far.map(idOf).join(',');
    this.state.reveal.tie = tie;
    this.state.hasReveal = true;
    this.state.deadline = 0;
    this.setPhase('REVEAL');
    this.io.broadcast('reveal', {
      roundId: this.#roundId,
      treasure: { x: this.#treasure.x, y: this.#treasure.y },
      picks: revealed,
      far: result.far.map(idOf),
      tie,
      replay: this.#replays,
    });
    this.state.phaseEndsAt = this.scheduler.now() + this.timing.revealMs;
    this.setPhaseTimer(this.timing.revealMs, () => this.#afterReveal(result.far));
  }

  /** BH-06, BH-07: 한 명이면 끝, 동점이면 동점자끼리 재대결 (최대 5번 뒤에는 무작위) */
  #afterReveal(far: readonly number[]): void {
    if (this.phase !== 'REVEAL') return;
    if (far.length === 1) {
      this.#finish(far[0] as number, false);
      return;
    }
    if (this.#replays >= treasure.MAX_REPLAYS) {
      this.#finish(far[this.rng.int(far.length)] as number, true);
      return;
    }
    this.#replays += 1;
    this.#startRound([...far]);
  }

  #finish(loserSeat: number, tieBreak: boolean): void {
    this.clearTurnTimers();
    this.clearPhaseTimer();
    this.#loserSeat = loserSeat;
    this.#tieBreak = tieBreak;
    const loser = this.#bySeat.get(loserSeat);
    this.state.loserId = loser?.id ?? '';
    this.state.tieBreak = tieBreak;
    this.state.deadline = 0;
    this.setPhase('GAME_OVER');
    this.io.broadcast('game_over', {
      loserId: loser?.id ?? '',
      treasure: { x: this.#treasure.x, y: this.#treasure.y },
      tieBreak,
    });
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
      replays: this.#replays,
      autoPicks: this.#autoPicks,
      lastMaxSq: this.#lastMaxSq,
      tieBreak: this.#tieBreak,
      loserSeat: this.#loserSeat,
    });
  }
}
