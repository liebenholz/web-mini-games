import { balloon } from '@wmg/rules';
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
import { BalloonPlayerState, BalloonState, BalloonTurnState } from './state.js';

export type { HandleResult, JoinResult } from '../../framework/game/LobbyMatch.js';

type Options = balloon.BalloonRoomOptions;
type ServerMessages = balloon.BalloonServerMessages;
type ServerMessageType = balloon.BalloonServerMessageType;
type Phase = balloon.BalloonPhase;

export const BALLOON_SPECTATOR_LIMIT = 20;
/** BL-13: 봇은 1~2초 생각한 뒤 시작한다 (공통 기본값은 최대 3초) */
const BOT_DELAY_SPAN_MS = 1000;
/** BL-12, BL-13: 대신 누를 때 펌프 사이 간격 0.4~0.8초 */
const PUMP_GAP_MS = 400;
const PUMP_GAP_SPAN_MS = 400;
const ROLL_SCALE = 1_000_000;

/** 엔진 → 네트워크. 방 어댑터(BalloonRoom)가 구현한다 */
export interface BalloonIO extends LobbyIO {
  broadcast<T extends ServerMessageType>(type: T, payload: ServerMessages[T]): void;
  sendTo<T extends ServerMessageType>(playerId: string, type: T, payload: ServerMessages[T]): void;
  onFinished?(record: BalloonRecord): void;
}

export interface BalloonRecord {
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
  readonly turns: readonly {
    readonly seat: number;
    readonly pumps: number;
    readonly isAuto: boolean;
    readonly isBot: boolean;
    readonly popped: boolean;
  }[];
  readonly threshold: number;
  readonly loserSeat: number;
}

export interface BalloonDeps {
  readonly io: BalloonIO;
  readonly rng: Rng;
  readonly scheduler: Scheduler;
  readonly timing: Timing;
}

interface Member extends LobbyMember<BalloonPlayerState> {
  seat: number;
  /** BL-12: 이어진 시간 초과 수 (한 번도 안 누르고 넘긴 차례만 센다) */
  consecutiveTimeouts: number;
}

interface How {
  readonly isBot: boolean;
  readonly isAuto: boolean;
}

/**
 * 풍선 터뜨리기 한 방의 진행 (docs/specs/balloon.md). 대기실·좌석·이탈·리매치는 LobbyMatch(ADR 0003)가 하고,
 * 여기서는 터지는 횟수 뽑기, 펌프·넘기기, 시간 초과 대신 누르기, 봇, 판 기록만 다룬다.
 */
export class BalloonMatch extends LobbyMatch<Options, BalloonPlayerState, Member, BalloonState, BalloonIO> {
  #game: balloon.BalloonState | null = null;
  #bySeat = new Map<number, Member>();
  #turns: { seat: number; pumps: number; isAuto: boolean; isBot: boolean; popped: boolean }[] = [];
  /** 이번 차례에 대신 누른(시간 초과·봇) 펌프가 있었나 */
  #turnAuto = false;
  #turnBot = false;
  /** 서버가 대신 누르는 중인 차례. 그 동안 사람의 입력은 막는다 */
  #autoTurnId = '';
  #gameId = '';
  #startedAt = new Date(0);
  #turnId = '';

  constructor(roomCode: string, options: Options, deps: BalloonDeps) {
    super(new BalloonState(), roomCode, options, deps);
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
    return BALLOON_SPECTATOR_LIMIT;
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

  protected createView(init: NewView): BalloonPlayerState {
    return new BalloonPlayerState({ ...init });
  }

  protected createMember(base: LobbyMember<BalloonPlayerState>): Member {
    return { ...base, seat: -1, consecutiveTimeouts: 0 };
  }

  protected parseOptions(input: unknown): { ok: true; options: Options } | { ok: false } {
    return balloon.parseBalloonOptions(input, this.opts);
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

  /** 공통: 게임 중 나가면 봇이 이어서 하고 알린다. 그 사람 차례였다면 봇이 이어서 누른다 */
  protected onSeatTakenOver(m: Member): void {
    m.view.replaced = true;
    m.view.autopilot = false;
    this.notifyReplaced(m, 'left');
    if (this.phase === 'PLAYING' && this.#game?.turn === m.seat && this.#autoTurnId !== this.#turnId)
      this.#scheduleBot(this.#turnId);
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
    if (type === 'pump' || type === 'end_turn') return this.#press(m, type, body);
    return fail('INVALID_MESSAGE', '알 수 없는 요청입니다.');
  }

  protected resetMemberForRematch(x: Member): void {
    x.seat = -1;
    x.consecutiveTimeouts = 0;
    x.view.seat = -1;
    x.view.autopilot = false;
  }

  /** BL-07: 같은 방 대기실로 */
  protected resetGameForRematch(): void {
    this.#clear();
  }

  // ───────────────────────── 진행 ─────────────────────────

  /** BL-01, BL-02: 좌석은 들어온 순서, 터지는 횟수와 첫 차례는 무작위 */
  protected beginGame(): void {
    const seated = this.seated().sort((a, b) => a.joinOrder - b.joinOrder);
    this.#bySeat.clear();
    seated.forEach((p, seat) => {
      p.seat = seat;
      p.consecutiveTimeouts = 0;
      Object.assign(p.view, { seat, autopilot: false });
      this.#bySeat.set(seat, p);
    });
    const range = balloon.thresholdRange(seated.length);
    const threshold = range.min + this.rng.int(range.max - range.min + 1);
    this.#game = balloon.createBalloon(seated.length, threshold, this.rng.int(seated.length));
    this.#turns = [];
    this.#gameId = this.rng.id();
    this.#startedAt = new Date(this.scheduler.now());
    this.replacedIds.clear();
    this.state.total = 0;
    this.state.turnPumps = 0;
    this.state.maxPops = range.max;
    this.state.history.clear();
    this.state.loserId = '';
    this.state.threshold = 0;
    this.state.phaseEndsAt = 0;
    this.setPhase('PLAYING');
    this.#startTurn();
  }

  #clear(): void {
    this.#game = null;
    this.#turns = [];
    this.#autoTurnId = '';
    this.state.total = 0;
    this.state.turnPumps = 0;
    this.state.maxPops = 0;
    this.state.history.clear();
    this.state.currentTurn = '';
    this.state.turnId = '';
    this.state.deadline = 0;
    this.state.loserId = '';
    this.state.threshold = 0;
  }

  #startTurn(): void {
    this.clearTurnTimers();
    const g = this.#game;
    if (!g) return;
    const player = this.#bySeat.get(g.turn);
    if (!player) return;
    this.#turnId = this.rng.id();
    this.#autoTurnId = '';
    this.#turnAuto = false;
    this.#turnBot = false;
    const deadline = this.scheduler.now() + this.opts.turnSeconds * this.timing.msPerTurnSecond;
    this.state.currentTurn = player.id;
    this.state.turnId = this.#turnId;
    this.state.deadline = deadline;
    this.state.turnPumps = 0;
    this.io.broadcast('turn_start', {
      playerId: player.id,
      turnId: this.#turnId,
      deadline,
      serverNow: this.scheduler.now(),
    });
    const turnId = this.#turnId;
    // BL-10, BL-12: 한 차례 전체에 마감 하나. 봇 자리는 시간 초과가 없다 (BL-14)
    this.setTurnTimer(deadline - this.scheduler.now(), () => this.#onTimeout(turnId));
    if (player.controller !== 'human') this.#scheduleBot(turnId);
  }

  /** BL-12 */
  #onTimeout(turnId: string): void {
    const g = this.#game;
    if (!g || this.phase !== 'PLAYING' || this.#turnId !== turnId) return;
    const m = this.#bySeat.get(g.turn);
    if (!m || m.controller !== 'human') return;
    if (g.turnPumps >= 1) {
      // 이미 눌렀으면 그냥 넘긴다. 연속 시간 초과로 세지 않는다
      this.#endTurn(m, { isBot: false, isAuto: false });
      return;
    }
    m.consecutiveTimeouts += 1;
    if (m.consecutiveTimeouts >= 2) {
      m.controller = 'autopilot';
      m.view.autopilot = true;
    }
    this.#autoChain(turnId, { isBot: false, isAuto: true });
  }

  #scheduleBot(turnId: string): void {
    this.setBotTimer(() => {
      const g = this.#game;
      if (!g || this.phase !== 'PLAYING' || this.#turnId !== turnId) return;
      const m = this.#bySeat.get(g.turn);
      if (!m || m.controller === 'human') return;
      this.#autoChain(turnId, { isBot: m.controller === 'bot', isAuto: m.controller === 'autopilot' });
    });
  }

  /** BL-12, BL-13: 1~3번(이번 차례에 남은 횟수 이내)을 0.4~0.8초 간격으로 누르고 넘긴다 */
  #autoChain(turnId: string, how: How): void {
    const g = this.#game;
    if (!g || this.phase !== 'PLAYING' || this.#turnId !== turnId) return;
    this.#autoTurnId = turnId;
    const left = balloon.MAX_PUMPS_PER_TURN - g.turnPumps;
    const count = Math.min(left, balloon.balloonPumps(this.rng.int(ROLL_SCALE) / ROLL_SCALE));
    if (count <= 0) {
      const m = this.#bySeat.get(g.turn);
      if (m) this.#endTurn(m, how);
      return;
    }
    this.#autoPump(turnId, count, how);
  }

  #autoPump(turnId: string, remaining: number, how: How): void {
    const g = this.#game;
    if (!g || this.phase !== 'PLAYING' || this.#turnId !== turnId) return;
    const m = this.#bySeat.get(g.turn);
    if (!m) return;
    const r = balloon.pump(g, m.seat);
    if (!r.ok) return;
    this.#apply(m, r, how);
    // 터졌거나 3번째라 차례가 끝났다면 #apply가 다음 차례를 시작했다
    if (this.phase !== 'PLAYING' || this.#turnId !== turnId) return;
    if (remaining > 1) {
      const gap = PUMP_GAP_MS + this.rng.int(PUMP_GAP_SPAN_MS + 1);
      this.setBotTimer(() => this.#autoPump(turnId, remaining - 1, how), gap);
    } else {
      this.setBotTimer(() => {
        const cur = this.#game;
        const who = cur ? this.#bySeat.get(cur.turn) : undefined;
        if (who && this.#turnId === turnId && this.phase === 'PLAYING') this.#endTurn(who, how);
      }, PUMP_GAP_MS);
    }
  }

  /** BL-03~BL-05, 9장 예외 */
  #press(m: Member, type: 'pump' | 'end_turn', body: Record<string, unknown>): HandleResult {
    const g = this.#game;
    if (!g || this.phase !== 'PLAYING') return fail('INVALID_STATE', '게임 중이 아닙니다.');
    if (m.spectator || m.seat < 0 || g.turn !== m.seat || m.controller === 'bot')
      return fail('NOT_YOUR_TURN', '내 차례가 아닙니다.');
    if (body.turnId !== this.#turnId || this.#autoTurnId === this.#turnId)
      return fail('STALE_TURN', '이미 지난 차례입니다.');
    // BL-12: 직접 누르면 돌려받는다
    const back = () => {
      m.consecutiveTimeouts = 0;
      if (m.controller === 'autopilot') {
        m.controller = 'human';
        m.view.autopilot = false;
      }
    };
    if (type === 'pump') {
      const r = balloon.pump(g, m.seat);
      if (!r.ok) return fail('INVALID_MOVE', '이번 차례에는 더 누를 수 없습니다.');
      back();
      this.#apply(m, r, { isBot: false, isAuto: false });
      return OK;
    }
    const r = balloon.endTurn(g, m.seat);
    if (!r.ok) return fail('INVALID_MOVE', '한 번 이상 누른 뒤에 넘길 수 있습니다.');
    back();
    this.#endTurn(m, { isBot: false, isAuto: false });
    return OK;
  }

  #endTurn(m: Member, how: How): void {
    const g = this.#game;
    if (!g) return;
    const r = balloon.endTurn(g, m.seat);
    if (r.ok) this.#apply(m, r, how, false);
  }

  /** 펌프 한 번(또는 넘기기)의 결과를 공유 상태와 메시지에 반영한다 */
  #apply(
    m: Member,
    r: { readonly state: balloon.BalloonState; readonly popped: boolean; readonly turnEnded: boolean },
    how: How,
    pumped = true,
  ): void {
    if (how.isAuto) this.#turnAuto = true;
    if (how.isBot) this.#turnBot = true;
    this.#game = r.state;
    this.state.total = r.state.total;
    const last = r.state.turns[r.state.turns.length - 1];
    if (pumped) {
      const pumps = r.turnEnded && last ? last.pumps : r.state.turnPumps;
      this.io.broadcast('pumped', {
        playerId: m.id,
        total: r.state.total,
        turnPumps: pumps,
        popped: r.popped,
        ...how,
      });
    }
    if (!r.turnEnded) {
      this.state.turnPumps = r.state.turnPumps;
      return;
    }
    this.clearTurnTimers();
    if (last) {
      this.#turns.push({
        seat: last.seat,
        pumps: last.pumps,
        isAuto: this.#turnAuto,
        isBot: this.#turnBot,
        popped: last.popped,
      });
      this.state.history.push(
        new BalloonTurnState({
          playerId: m.id,
          pumps: last.pumps,
          isAuto: this.#turnAuto,
          popped: last.popped,
        }),
      );
    }
    if (r.state.loser !== null) {
      this.#finish();
      return;
    }
    this.#startTurn();
  }

  /** BL-06, BL-22 */
  #finish(): void {
    const g = this.#game;
    if (!g || g.loser === null) return;
    this.clearTurnTimers();
    const loser = this.#bySeat.get(g.loser);
    this.state.loserId = loser?.id ?? '';
    this.state.threshold = g.threshold;
    this.state.currentTurn = '';
    this.state.turnId = '';
    this.state.deadline = 0;
    this.state.turnPumps = 0;
    this.setPhase('GAME_OVER');
    this.io.broadcast('game_over', { loserId: loser?.id ?? '', threshold: g.threshold });
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
      turns: [...this.#turns],
      threshold: g.threshold,
      loserSeat: g.loser,
    });
  }
}
