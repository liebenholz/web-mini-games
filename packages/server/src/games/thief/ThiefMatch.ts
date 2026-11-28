import { thief } from '@wmg/rules';
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
import { shuffle, type Rng } from '../../framework/rng.js';
import type { Scheduler } from '../../framework/scheduler.js';
import type { Timing } from '../liars-dice/LiarsDiceMatch.js';
import { ThiefPlayerState, ThiefState } from './state.js';

export type { HandleResult, JoinResult } from '../../framework/game/LobbyMatch.js';

type Options = thief.ThiefRoomOptions;
type ServerMessages = thief.ThiefServerMessages;
type ServerMessageType = thief.ThiefServerMessageType;
type Phase = thief.ThiefPhase;

export const THIEF_SPECTATOR_LIMIT = 20;
/** TF-13: 봇은 1~2초 뒤에 뽑는다 (공통 기본값은 최대 3초) */
const BOT_DELAY_SPAN_MS = 1000;
const ROLL_SCALE = 1_000_000;

export interface ThiefIO extends LobbyIO {
  broadcast<T extends ServerMessageType>(type: T, payload: ServerMessages[T]): void;
  sendTo<T extends ServerMessageType>(playerId: string, type: T, payload: ServerMessages[T]): void;
  onFinished?(record: ThiefRecord): void;
}

export interface ThiefRecord {
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
    /** 빠진 순서 (1부터). 당첨자는 가장 큰 값 */
    readonly outOrder: number;
  }[];
  readonly draws: number;
  readonly autoDraws: number;
  /** 내려놓은 짝 수 */
  readonly pairs: number;
  readonly loserSeat: number;
}

export interface ThiefDeps {
  readonly io: ThiefIO;
  readonly rng: Rng;
  readonly scheduler: Scheduler;
  readonly timing: Timing;
}

interface Member extends LobbyMember<ThiefPlayerState> {
  seat: number;
  /** TF-12: 이어진 시간 초과 수 */
  consecutiveTimeouts: number;
}

interface How {
  readonly isBot: boolean;
  readonly isAuto: boolean;
}

/**
 * 도둑잡기 한 방의 진행 (docs/specs/thief.md). 대기실·좌석·이탈·리매치는 LobbyMatch(ADR 0003)가 하고,
 * 여기서는 섞기·나누기, 뽑기, 시간 초과·봇, 패 전송(본인에게만), 판 기록만 다룬다.
 */
export class ThiefMatch extends LobbyMatch<Options, ThiefPlayerState, Member, ThiefState, ThiefIO> {
  #game: thief.ThiefState | null = null;
  #bySeat = new Map<number, Member>();
  #turnId = '';
  #autoDraws = 0;
  #gameId = '';
  #startedAt = new Date(0);

  constructor(roomCode: string, options: Options, deps: ThiefDeps) {
    super(new ThiefState(), roomCode, options, deps);
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
    return THIEF_SPECTATOR_LIMIT;
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

  protected createView(init: NewView): ThiefPlayerState {
    return new ThiefPlayerState({ ...init });
  }

  protected createMember(base: LobbyMember<ThiefPlayerState>): Member {
    return { ...base, seat: -1, consecutiveTimeouts: 0 };
  }

  protected parseOptions(input: unknown): { ok: true; options: Options } | { ok: false } {
    return thief.parseThiefOptions(input, this.opts);
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

  /** 공통: 게임 중 나가면 봇이 이어서 한다. 패는 그대로 이어받고, 그 사람 차례였다면 봇이 이어서 뽑는다 */
  protected onSeatTakenOver(m: Member): void {
    m.view.replaced = true;
    m.view.autopilot = false;
    this.notifyReplaced(m, 'left');
    if (this.phase === 'PLAYING' && this.#game?.turn === m.seat) this.#scheduleBot(this.#turnId);
  }

  /** 복귀하면 내 패와 현재 차례를 다시 보낸다 (원칙 4: 본인에게만) */
  resendPrivate(playerId: string): void {
    const m = this.members.get(playerId);
    if (!m || this.phase !== 'PLAYING' || m.seat < 0) return;
    this.#sendHand(m);
    if (this.state.currentTurn)
      this.io.sendTo(playerId, 'turn_start', {
        playerId: this.state.currentTurn,
        targetId: this.state.targetId,
        turnId: this.#turnId,
        deadline: this.state.deadline,
        serverNow: this.scheduler.now(),
      });
  }

  protected handleGame(m: Member, type: string, body: Record<string, unknown>): HandleResult {
    if (type === 'draw') return this.#draw(m, body);
    return fail('INVALID_MESSAGE', '알 수 없는 요청입니다.');
  }

  protected resetMemberForRematch(x: Member): void {
    x.seat = -1;
    x.consecutiveTimeouts = 0;
    Object.assign(x.view, { seat: -1, handCount: 0, out: false, outOrder: 0, autopilot: false });
    x.view.finalHand.clear();
  }

  /** TF: 같은 방 대기실로 */
  protected resetGameForRematch(): void {
    this.#game = null;
    this.clearTurnTimers();
    const s = this.state;
    s.currentTurn = '';
    s.targetId = '';
    s.turnId = '';
    s.deadline = 0;
    s.loserId = '';
    s.draws = 0;
    s.pairs.clear();
  }

  // ───────────────────────── 진행 ─────────────────────────

  /** TF-01~TF-04: 좌석은 들어온 순서, 섞기·나누기·첫 짝 내기는 서버가 한다 */
  protected beginGame(): void {
    const seated = this.seated().sort((a, b) => a.joinOrder - b.joinOrder);
    this.#bySeat.clear();
    seated.forEach((p, seat) => {
      p.seat = seat;
      p.consecutiveTimeouts = 0;
      Object.assign(p.view, { seat, handCount: 0, out: false, outOrder: 0, autopilot: false });
      p.view.finalHand.clear();
      this.#bySeat.set(seat, p);
    });
    this.#autoDraws = 0;
    this.#gameId = this.rng.id();
    this.#startedAt = new Date(this.scheduler.now());
    this.replacedIds.clear();
    const s = this.state;
    s.draws = 0;
    s.loserId = '';
    s.pairs.clear();
    s.phaseEndsAt = 0;
    const game = thief.createThief(
      shuffle(thief.fullDeck(), this.rng),
      seated.length,
      this.rng.int(seated.length),
    );
    this.#game = game;
    for (const r of game.pairs) s.pairs.push(r);
    game.outOrder.forEach((seat, i) => {
      const m = this.#bySeat.get(seat);
      if (m) m.view.outOrder = i + 1;
    });
    this.#syncViews();
    this.setPhase('PLAYING');
    for (const m of this.#bySeat.values()) this.#sendHand(m);
    if (thief.isFinished(game)) this.#finish();
    else this.#startTurn();
  }

  /** 공유 상태에는 장수와 안전 여부만 (원칙 4) */
  #syncViews(): void {
    const g = this.#game;
    if (!g) return;
    for (const [seat, m] of this.#bySeat) {
      m.view.handCount = g.hands[seat]?.length ?? 0;
      m.view.out = g.out[seat] === true;
    }
  }

  #sendHand(m: Member): void {
    const g = this.#game;
    if (!g || m.originallyBot) return;
    this.io.sendTo(m.id, 'your_hand', { cards: [...(g.hands[m.seat] ?? [])] });
  }

  #startTurn(): void {
    this.clearTurnTimers();
    const g = this.#game;
    if (!g) return;
    const player = this.#bySeat.get(g.turn);
    const target = this.#bySeat.get(thief.targetOf(g, g.turn));
    if (!player || !target) return;
    this.#turnId = this.rng.id();
    const deadline = this.scheduler.now() + this.opts.turnSeconds * this.timing.msPerTurnSecond;
    this.state.currentTurn = player.id;
    this.state.targetId = target.id;
    this.state.turnId = this.#turnId;
    this.state.deadline = deadline;
    this.io.broadcast('turn_start', {
      playerId: player.id,
      targetId: target.id,
      turnId: this.#turnId,
      deadline,
      serverNow: this.scheduler.now(),
    });
    const turnId = this.#turnId;
    // TF-12: 한 차례에 마감 하나. 봇 자리는 시간 초과가 없다
    this.setTurnTimer(deadline - this.scheduler.now(), () => this.#onTimeout(turnId));
    if (player.controller !== 'human') this.#scheduleBot(turnId);
  }

  #randomIndex(count: number): number {
    return thief.thiefBotIndex(count, this.rng.int(ROLL_SCALE) / ROLL_SCALE);
  }

  /** TF-12 */
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
    this.#doDraw(m, this.#randomIndex(g.hands[thief.targetOf(g, m.seat)]?.length ?? 0), {
      isBot: false,
      isAuto: true,
    });
  }

  /** TF-13: 1~2초 뒤 무작위 위치를 뽑는다 */
  #scheduleBot(turnId: string): void {
    this.setBotTimer(() => {
      const g = this.#game;
      if (!g || this.phase !== 'PLAYING' || this.#turnId !== turnId) return;
      const m = this.#bySeat.get(g.turn);
      if (!m || m.controller === 'human') return;
      this.#doDraw(m, this.#randomIndex(g.hands[thief.targetOf(g, m.seat)]?.length ?? 0), {
        isBot: m.controller === 'bot',
        isAuto: m.controller === 'autopilot',
      });
    });
  }

  /** TF-05 */
  #draw(m: Member, body: Record<string, unknown>): HandleResult {
    const g = this.#game;
    if (!g || this.phase !== 'PLAYING') return fail('INVALID_STATE', '게임 중이 아닙니다.');
    if (m.spectator || m.seat < 0 || m.controller === 'bot')
      return fail('NOT_YOUR_TURN', '내 차례가 아닙니다.');
    // TE-04, TE-05: 이미 뽑은 차례의 입력은 차례가 넘어간 뒤에도 STALE_TURN
    if (body.turnId !== this.#turnId) return fail('STALE_TURN', '이미 지난 차례입니다.');
    if (g.turn !== m.seat) return fail('NOT_YOUR_TURN', '내 차례가 아닙니다.');
    const probe = thief.draw(g, m.seat, body.index, (c) => [...c]);
    if (!probe.ok) return fail('INVALID_MOVE', '뽑을 수 없는 위치입니다.');
    // TF-12: 직접 뽑으면 돌려받는다
    m.consecutiveTimeouts = 0;
    if (m.controller === 'autopilot') {
      m.controller = 'human';
      m.view.autopilot = false;
    }
    this.#doDraw(m, body.index as number, { isBot: false, isAuto: false });
    return OK;
  }

  #doDraw(m: Member, index: number, how: How): void {
    const g = this.#game;
    if (!g) return;
    const r = thief.draw(g, m.seat, index, (c) => shuffle(c, this.rng));
    if (!r.ok) return;
    if (how.isAuto) this.#autoDraws += 1;
    this.#game = r.state;
    const target = this.#bySeat.get(r.target);
    if (r.matched) this.state.pairs.push(r.matched);
    this.state.draws = r.state.draws;
    this.#syncViews();
    this.clearTurnTimers();
    // 뽑은 카드가 무엇인지는 짝이 맞았을 때의 숫자만 공개한다 (원칙 4)
    this.io.broadcast('drawn', {
      fromId: target?.id ?? '',
      toId: m.id,
      matched: r.matched,
      drawerOut: r.drawerOut,
      targetOut: r.targetOut,
      ...how,
    });
    this.#sendHand(m);
    if (target) this.#sendHand(target);
    const order = r.state.outOrder;
    const outs = [...(r.drawerOut ? [m] : []), ...(r.targetOut && target ? [target] : [])];
    for (const p of outs) {
      const n = order.indexOf(p.seat) + 1;
      p.view.outOrder = n;
      this.io.broadcast('player_out', { playerId: p.id, order: n });
    }
    if (thief.isFinished(r.state)) this.#finish();
    else this.#startTurn();
  }

  /** TF-10, TF-11 */
  #finish(): void {
    const g = this.#game;
    if (!g) return;
    this.clearTurnTimers();
    const loserSeat = thief.loserSeat(g) ?? -1;
    const loser = this.#bySeat.get(loserSeat);
    const order = g.outOrder.length + 1;
    if (loser) loser.view.outOrder = order;
    const hands = [...this.#bySeat.values()].map((p) => ({
      playerId: p.id,
      cards: [...(g.hands[p.seat] ?? [])],
    }));
    for (const p of this.#bySeat.values()) {
      p.view.finalHand.clear();
      for (const c of g.hands[p.seat] ?? []) p.view.finalHand.push(c);
    }
    const s = this.state;
    s.loserId = loser?.id ?? '';
    s.currentTurn = '';
    s.targetId = '';
    s.turnId = '';
    s.deadline = 0;
    this.setPhase('GAME_OVER');
    this.io.broadcast('game_over', { loserId: loser?.id ?? '', hands });
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
        outOrder: p.view.outOrder,
      })),
      draws: g.draws,
      autoDraws: this.#autoDraws,
      pairs: g.pairs.length,
      loserSeat,
    });
  }
}
