import { yacht } from '@wmg/rules';
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
import { rollDie, type Rng } from '../../framework/rng.js';
import type { Scheduler } from '../../framework/scheduler.js';
import type { Timing } from '../liars-dice/LiarsDiceMatch.js';
import { YachtPlayerState, YachtState } from './state.js';

export type { HandleResult, JoinResult } from '../../framework/game/LobbyMatch.js';

type Options = yacht.YachtRoomOptions;
type ServerMessages = yacht.YachtServerMessages;
type ServerMessageType = yacht.YachtServerMessageType;
type Phase = yacht.YachtPhase;

export const YACHT_SPECTATOR_LIMIT = 20;
/** YT-13: 봇은 1~2초마다 한 동작씩 한다 (공통 기본값은 최대 3초) */
const BOT_DELAY_SPAN_MS = 1000;

export interface YachtIO extends LobbyIO {
  broadcast<T extends ServerMessageType>(type: T, payload: ServerMessages[T]): void;
  sendTo<T extends ServerMessageType>(playerId: string, type: T, payload: ServerMessages[T]): void;
  onFinished?(record: YachtRecord): void;
}

export interface YachtRecord {
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
    readonly scores: readonly number[];
    readonly total: number;
    readonly bonus: number;
  }[];
  /** 끝난 차례 수 (사람 수 × 12) */
  readonly turns: number;
  /** 시간 초과·자동 진행으로 서버가 대신 기록한 차례 수 */
  readonly autoTurns: number;
}

export interface YachtDeps {
  readonly io: YachtIO;
  readonly rng: Rng;
  readonly scheduler: Scheduler;
  readonly timing: Timing;
}

interface Member extends LobbyMember<YachtPlayerState> {
  seat: number;
  /** YT-12: 이어진 시간 초과 수 */
  consecutiveTimeouts: number;
}

interface How {
  readonly isBot: boolean;
  readonly isAuto: boolean;
}

/**
 * 요트 주사위 한 방의 진행 (docs/specs/yacht.md). 대기실·좌석·이탈·리매치는 LobbyMatch(ADR 0003)가 하고,
 * 여기서는 굴리기·기록, 시간 초과 대신 두기, 봇, 판 기록만 다룬다.
 */
export class YachtMatch extends LobbyMatch<Options, YachtPlayerState, Member, YachtState, YachtIO> {
  #game: yacht.YachtState | null = null;
  #bySeat = new Map<number, Member>();
  #turnId = '';
  /** 이번 차례에 사람이 직접 한 동작이 있나 (있으면 시간 초과로 세지 않는다) */
  #turnActed = false;
  #autoTurns = 0;
  #gameId = '';
  #startedAt = new Date(0);

  constructor(roomCode: string, options: Options, deps: YachtDeps) {
    super(new YachtState(), roomCode, options, deps);
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
    return YACHT_SPECTATOR_LIMIT;
  }

  protected override notEnoughPlayersMessage(): string {
    return '2명 이상이 필요합니다.';
  }

  protected override checkOptions(next: Options): string | null {
    return next.maxPlayers < this.seated().length ? '지금 인원보다 적게 줄일 수 없습니다.' : null;
  }

  protected override rematchOrder(a: Member, b: Member): number {
    return Number(a.spectator) - Number(b.spectator) || a.joinOrder - b.joinOrder;
  }

  protected createView(init: NewView): YachtPlayerState {
    return new YachtPlayerState({ ...init });
  }

  protected createMember(base: LobbyMember<YachtPlayerState>): Member {
    return { ...base, seat: -1, consecutiveTimeouts: 0 };
  }

  protected parseOptions(input: unknown): { ok: true; options: Options } | { ok: false } {
    return yacht.parseYachtOptions(input, this.opts);
  }

  protected writeOptions(): void {
    const o = this.state.options;
    const v = this.opts;
    o.maxPlayers = v.maxPlayers;
    o.turnSeconds = v.turnSeconds;
    o.fillWithBots = v.fillWithBots;
    o.isPrivate = v.isPrivate;
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

  /** 공통: 게임 중 나가면 봇이 이어서 한다. 그 사람 차례였다면 봇이 이어서 둔다 */
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
    if (type === 'roll') return this.#roll(m, body);
    if (type === 'score') return this.#score(m, body);
    return fail('INVALID_MESSAGE', '알 수 없는 요청입니다.');
  }

  protected resetMemberForRematch(x: Member): void {
    x.seat = -1;
    x.consecutiveTimeouts = 0;
    x.view.seat = -1;
    x.view.autopilot = false;
    this.#resetScores(x);
  }

  /** YT-11: 같은 방 대기실로 */
  protected resetGameForRematch(): void {
    this.#game = null;
    this.#clearTurnState();
    this.state.turnsDone = 0;
  }

  // ───────────────────────── 진행 ─────────────────────────

  /** YT-01: 좌석은 들어온 순서, 첫 차례는 무작위 */
  protected beginGame(): void {
    const seated = this.seated().sort((a, b) => a.joinOrder - b.joinOrder);
    this.#bySeat.clear();
    seated.forEach((p, seat) => {
      p.seat = seat;
      p.consecutiveTimeouts = 0;
      Object.assign(p.view, { seat, autopilot: false });
      this.#resetScores(p);
      this.#bySeat.set(seat, p);
    });
    this.#game = yacht.createYacht(seated.length, this.rng.int(seated.length));
    this.#autoTurns = 0;
    this.#gameId = this.rng.id();
    this.#startedAt = new Date(this.scheduler.now());
    this.replacedIds.clear();
    this.state.turnsDone = 0;
    this.state.phaseEndsAt = 0;
    this.setPhase('PLAYING');
    this.#startTurn();
  }

  #resetScores(m: Member): void {
    m.view.scores.clear();
    for (let i = 0; i < yacht.CATEGORY_COUNT; i += 1) m.view.scores.push(yacht.EMPTY);
    m.view.upperSum = 0;
    m.view.bonus = 0;
    m.view.total = 0;
  }

  #clearTurnState(): void {
    this.clearTurnTimers();
    this.state.currentTurn = '';
    this.state.turnId = '';
    this.state.deadline = 0;
    this.state.dice.clear();
    this.state.held.clear();
    this.state.rollNo = 0;
  }

  #startTurn(): void {
    this.clearTurnTimers();
    const g = this.#game;
    if (!g) return;
    const player = this.#bySeat.get(g.turn);
    if (!player) return;
    this.#turnId = this.rng.id();
    this.#turnActed = false;
    const deadline = this.scheduler.now() + this.opts.turnSeconds * this.timing.msPerTurnSecond;
    this.state.currentTurn = player.id;
    this.state.turnId = this.#turnId;
    this.state.deadline = deadline;
    this.state.rollNo = 0;
    // 지난 차례의 주사위는 새 차례가 시작될 때까지 보인다(YT-09 기록 뒤에도 남겨 두고 첫 굴림에서 바꾼다)
    this.io.broadcast('turn_start', {
      playerId: player.id,
      turnId: this.#turnId,
      deadline,
      serverNow: this.scheduler.now(),
    });
    const turnId = this.#turnId;
    // YT-10: 한 차례에 마감 하나. 봇 자리는 시간 초과가 없다
    this.setTurnTimer(deadline - this.scheduler.now(), () => this.#onTimeout(turnId));
    if (player.controller !== 'human') this.#scheduleBot(turnId);
  }

  /** YT-12 */
  #onTimeout(turnId: string): void {
    const g = this.#game;
    if (!g || this.phase !== 'PLAYING' || this.#turnId !== turnId) return;
    const m = this.#bySeat.get(g.turn);
    if (!m || m.controller !== 'human') return;
    if (!this.#turnActed) {
      m.consecutiveTimeouts += 1;
      if (m.consecutiveTimeouts >= 2) {
        m.controller = 'autopilot';
        m.view.autopilot = true;
      }
    }
    const how: How = { isBot: false, isAuto: true };
    if (g.rollNo === 0) this.#doRoll(m, new Array<boolean>(yacht.DICE_COUNT).fill(false), how);
    const cur = this.#game;
    if (!cur || this.phase !== 'PLAYING' || this.#turnId !== turnId) return;
    this.#doScore(m, yacht.autoCategory(cur.dice, cur.scores[m.seat] ?? []), how);
  }

  /** YT-13: 봇과 자동 진행은 한 번에 한 동작씩 1~2초 간격으로 둔다 */
  #scheduleBot(turnId: string): void {
    this.setBotTimer(() => {
      const g = this.#game;
      if (!g || this.phase !== 'PLAYING' || this.#turnId !== turnId) return;
      const m = this.#bySeat.get(g.turn);
      if (!m || m.controller === 'human') return;
      const how: How = { isBot: m.controller === 'bot', isAuto: m.controller === 'autopilot' };
      const mine = g.scores[m.seat] ?? [];
      if (g.rollNo === 0) {
        this.#doRoll(m, new Array<boolean>(yacht.DICE_COUNT).fill(false), how);
      } else {
        const keep = g.rollNo < yacht.MAX_ROLLS ? yacht.yachtBotKeep(g.dice, mine) : null;
        if (keep) this.#doRoll(m, keep, how);
        else {
          this.#doScore(m, yacht.yachtBotCategory(g.dice, mine), how);
          return;
        }
      }
      if (this.phase === 'PLAYING' && this.#turnId === turnId) this.#scheduleBot(turnId);
    });
  }

  #guard(m: Member, body: Record<string, unknown>): HandleResult | null {
    const g = this.#game;
    if (!g || this.phase !== 'PLAYING') return fail('INVALID_STATE', '게임 중이 아닙니다.');
    if (m.spectator || m.seat < 0 || g.turn !== m.seat || m.controller === 'bot')
      return fail('NOT_YOUR_TURN', '내 차례가 아닙니다.');
    if (body.turnId !== this.#turnId) return fail('STALE_TURN', '이미 지난 차례입니다.');
    return null;
  }

  /** YT-12: 직접 하면 돌려받는다 */
  #takeBack(m: Member): void {
    this.#turnActed = true;
    m.consecutiveTimeouts = 0;
    if (m.controller === 'autopilot') {
      m.controller = 'human';
      m.view.autopilot = false;
    }
  }

  #roll(m: Member, body: Record<string, unknown>): HandleResult {
    const guard = this.#guard(m, body);
    if (guard) return guard;
    const g = this.#game as yacht.YachtState;
    if (!this.#validKeep(g, body.keep)) return fail('INVALID_MOVE', '굴릴 수 없는 선택입니다.');
    this.#takeBack(m);
    this.#doRoll(m, body.keep as boolean[], { isBot: false, isAuto: false });
    return OK;
  }

  #validKeep(g: yacht.YachtState, keep: unknown): boolean {
    return (
      Array.isArray(keep) &&
      keep.length === yacht.DICE_COUNT &&
      keep.every((k) => typeof k === 'boolean') &&
      g.rollNo < yacht.MAX_ROLLS &&
      (g.rollNo > 0 || !keep.some(Boolean)) &&
      (g.rollNo === 0 || !keep.every(Boolean))
    );
  }

  #doRoll(m: Member, keep: readonly boolean[], how: How): void {
    const g = this.#game;
    if (!g) return;
    const fresh = Array.from({ length: yacht.freshCount(keep) }, () => rollDie(this.rng));
    const r = yacht.rollDice(g, m.seat, keep, fresh);
    if (!r.ok) return;
    this.#game = r.state;
    this.state.dice.clear();
    for (const d of r.state.dice) this.state.dice.push(d);
    this.state.held.clear();
    for (const k of keep) this.state.held.push(k ? 1 : 0);
    this.state.rollNo = r.state.rollNo;
    this.io.broadcast('dice_rolled', {
      playerId: m.id,
      dice: r.state.dice,
      held: keep,
      rollNo: r.state.rollNo,
      ...how,
    });
  }

  #score(m: Member, body: Record<string, unknown>): HandleResult {
    const guard = this.#guard(m, body);
    if (guard) return guard;
    const g = this.#game as yacht.YachtState;
    const r = yacht.scoreTurn(g, m.seat, body.category);
    if (!r.ok) return fail('INVALID_MOVE', '기록할 수 없는 칸입니다.');
    this.#takeBack(m);
    this.#doScore(m, body.category as number, { isBot: false, isAuto: false });
    return OK;
  }

  #doScore(m: Member, category: number, how: How): void {
    const g = this.#game;
    if (!g) return;
    const r = yacht.scoreTurn(g, m.seat, category);
    if (!r.ok) return;
    if (how.isAuto) this.#autoTurns += 1;
    this.#game = r.state;
    const mine = r.state.scores[m.seat] ?? [];
    mine.forEach((v, i) => (m.view.scores[i] = v));
    m.view.upperSum = yacht.upperSum(mine);
    m.view.bonus = yacht.bonusOf(mine);
    m.view.total = yacht.totalOf(mine);
    this.state.turnsDone = r.state.turnsDone;
    this.io.broadcast('scored', {
      playerId: m.id,
      category,
      points: r.points ?? 0,
      upperSum: m.view.upperSum,
      bonus: m.view.bonus,
      total: m.view.total,
      ...how,
    });
    this.clearTurnTimers();
    if (yacht.isFinished(r.state)) {
      this.#finish(r.state);
      return;
    }
    this.#startTurn();
  }

  /** YT-08 */
  #finish(g: yacht.YachtState): void {
    this.#clearTurnState();
    const seats = [...this.#bySeat.values()].sort((a, b) => a.seat - b.seat);
    const totals = g.scores.map((row) => yacht.totalOf(row));
    const rank = yacht.ranks(totals);
    this.setPhase('GAME_OVER');
    this.io.broadcast('game_over', {
      ranking: seats
        .map((p) => ({ playerId: p.id, total: totals[p.seat] ?? 0, rank: rank[p.seat] ?? 1 }))
        .sort((a, b) => a.rank - b.rank),
    });
    this.io.onFinished?.({
      gameId: this.#gameId,
      roomCode: this.state.roomCode,
      startedAt: this.#startedAt,
      endedAt: new Date(this.scheduler.now()),
      options: this.opts,
      players: seats.map((p) => ({
        playerId: p.id,
        guestId: p.guestId,
        nickname: p.nickname,
        seat: p.seat,
        isBot: p.originallyBot,
        replaced: this.replacedIds.has(p.id),
        scores: g.scores[p.seat] ?? [],
        total: totals[p.seat] ?? 0,
        bonus: yacht.bonusOf(g.scores[p.seat] ?? []),
      })),
      turns: g.turnsDone,
      autoTurns: this.#autoTurns,
    });
  }
}
