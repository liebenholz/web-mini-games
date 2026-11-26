import { bulls } from '@wmg/rules';
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
import { BullsGuessState, BullsPlayerState, BullsState } from './state.js';

type Options = bulls.BullsRoomOptions;
type Phase = bulls.BullsPhase;
type Seat = 0 | 1;
type ServerMessages = bulls.BullsServerMessages;
type ServerMessageType = bulls.BullsServerMessageType;

export const BULLS_SPECTATOR_LIMIT = 20;

/** 엔진 → 네트워크. 방 어댑터(BullsRoom)가 구현한다 */
export interface BullsIO extends LobbyIO {
  broadcast<T extends ServerMessageType>(type: T, payload: ServerMessages[T]): void;
  sendTo<T extends ServerMessageType>(playerId: string, type: T, payload: ServerMessages[T]): void;
  onFinished?(record: BullsRecord): void;
}

export interface BullsRecord {
  readonly gameId: string;
  readonly roomCode: string;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly options: Options;
  readonly players: readonly {
    readonly guestId: string | null;
    readonly nickname: string;
    readonly seat: Seat;
    readonly attempts: number;
    readonly isBot: boolean;
    readonly replaced: boolean;
  }[];
  readonly result: bulls.BullsEndResult;
  readonly winnerSeat: Seat | null;
  readonly lastChance: boolean;
  readonly skippedTurns: number;
}

export interface BullsDeps {
  readonly io: BullsIO;
  readonly rng: Rng;
  readonly scheduler: Scheduler;
  readonly timing: Timing;
}

export type { HandleResult, JoinResult } from '../../framework/game/LobbyMatch.js';

const MESSAGES: Record<bulls.BullsErrorCode, string> = {
  NOT_YOUR_TURN: '내 차례가 아닙니다.',
  INVALID_GUESS: '0~9 숫자를 겹치지 않게 자릿수만큼 넣어 주세요.',
  INVALID_STATE: '지금은 할 수 없습니다.',
};

interface Member extends LobbyMember<BullsPlayerState> {
  seat: Seat | null;
  secret: string;
  consecutiveTimeouts: number;
}

/**
 * 숫자야구 한 방의 진행 (docs/specs/bulls-and-cows.md). 규칙은 @wmg/rules의 bulls 엔진이 판정하고,
 * 대기실·좌석·이탈·리매치는 LobbyMatch(ADR 0003)가 한다. 여기서는 비밀 숫자 단계(B-30),
 * 턴 시간(B-31, B-32), 봇, 정보 은닉(B-20~B-23)을 맡는다.
 */
export class BullsMatch extends LobbyMatch<Options, BullsPlayerState, Member, BullsState, BullsIO> {
  #game: bulls.BullsState | null = null;
  #gameId = '';
  #startedAt = new Date(0);
  #skipped = 0;
  #hadLastChance = false;
  #turnId = '';

  constructor(roomCode: string, options: Options, deps: BullsDeps) {
    super(new BullsState(), roomCode, options, deps);
    this.writeOptions();
    this.updateListing();
  }

  override get phase(): Phase {
    return this.state.phase as Phase;
  }

  /** 테스트용: 서버만 아는 진행 상태 */
  get game(): bulls.BullsState | null {
    return this.#game;
  }

  // ───────────────────────── 대기실 훅 ─────────────────────────

  protected maxSeats(): number {
    return bulls.BULLS_PLAYERS;
  }

  protected spectatorLimit(): number {
    return BULLS_SPECTATOR_LIMIT;
  }

  protected createView(init: NewView): BullsPlayerState {
    return new BullsPlayerState({ ...init });
  }

  protected createMember(base: LobbyMember<BullsPlayerState>): Member {
    return { ...base, seat: null, secret: '', consecutiveTimeouts: 0 };
  }

  protected parseOptions(input: unknown): { ok: true; options: Options } | { ok: false } {
    return bulls.parseBullsOptions(input, this.opts);
  }

  protected writeOptions(): void {
    Object.assign(this.state.options, this.opts);
  }

  /** B-33: 비밀 숫자 단계도 게임 중이다 (끊김·복귀 알림) */
  protected isPlaying(): boolean {
    return this.phase === 'SECRET' || this.phase === 'PLAYING';
  }

  protected isGameOver(): boolean {
    return this.phase === 'GAME_OVER';
  }

  protected notifyReplaced(m: Member, reason: ReplaceReason): void {
    this.io.broadcast('player_replaced', { playerId: m.id, nickname: m.nickname, reason });
  }

  /** B-34: 게임 중 나가면 봇이 이어서 추측한다. 비밀 숫자를 아직 안 정했으면 대신 정한다 */
  protected onSeatTakenOver(m: Member): void {
    m.view.replaced = true;
    m.view.autopilot = false;
    this.notifyReplaced(m, 'left');
    if (this.phase === 'SECRET' && !m.secret) this.#setSecret(m, this.#randomSecret());
    else if (this.phase === 'PLAYING' && this.#game && this.#game.turn === m.seat)
      this.#scheduleBot(this.#turnId);
  }

  /** B-21: 복귀하면 내 비밀 숫자와 현재 차례를 다시 보낸다 */
  resendPrivate(playerId: string): void {
    const m = this.members.get(playerId);
    if (!m) return;
    if (m.secret && m.seat !== null && this.isPlaying())
      this.io.sendTo(m.id, 'your_secret', { digits: m.secret });
    if (this.phase === 'PLAYING' && this.state.currentTurn)
      this.io.sendTo(playerId, 'turn_start', {
        playerId: this.state.currentTurn,
        turnId: this.#turnId,
        deadline: this.state.deadline,
        serverNow: this.scheduler.now(),
        lastChance: this.state.lastChance,
      });
  }

  protected handleGame(m: Member, type: string, body: Record<string, unknown>): HandleResult {
    switch (type) {
      case 'set_secret':
      case 'random_secret':
        return this.#secretMsg(m, type, body);
      case 'guess':
        return this.#guess(m, body);
      default:
        return fail('INVALID_MESSAGE', '알 수 없는 요청입니다.');
    }
  }

  protected resetMemberForRematch(x: Member): void {
    x.seat = null;
    x.secret = '';
    x.consecutiveTimeouts = 0;
    Object.assign(x.view, { seat: -1, secretSet: false, attempts: 0, revealed: '', autopilot: false });
  }

  /** B-10: 같은 방 대기실로 */
  protected resetGameForRematch(): void {
    this.#game = null;
    this.state.history.clear();
    this.state.result = '';
    this.state.winnerId = '';
  }

  // ───────────────────────── 비밀 숫자 (B-30) ─────────────────────────

  /** B-06: 선공은 무작위. 자리 0이 선공 */
  protected beginGame(): void {
    const seated = this.seated().sort((a, b) => a.joinOrder - b.joinOrder);
    const firstIndex = this.rng.int(2);
    const order = firstIndex === 0 ? seated : [...seated].reverse();
    order.forEach((p, i) => {
      p.seat = i as Seat;
      p.secret = '';
      p.consecutiveTimeouts = 0;
      if (p.controller === 'autopilot') p.controller = 'human';
      Object.assign(p.view, { seat: i, secretSet: false, attempts: 0, revealed: '', autopilot: false });
    });
    this.#gameId = this.rng.id();
    this.#startedAt = new Date(this.scheduler.now());
    this.replacedIds.clear();
    this.#skipped = 0;
    this.#hadLastChance = false;
    this.state.history.clear();
    this.state.result = '';
    this.state.winnerId = '';
    this.state.lastChance = false;
    this.setPhase('SECRET');
    const ms = bulls.SECRET_MS * (this.timing.msPerTurnSecond / 1000);
    this.state.phaseEndsAt = this.scheduler.now() + ms;
    // 봇은 바로 정한다 (B-36)
    for (const p of order) if (p.controller !== 'human') this.#setSecret(p, this.#randomSecret());
    if (this.phase !== 'SECRET') return;
    this.setPhaseTimer(ms, () => {
      for (const p of this.#players()) if (!p.secret) this.#setSecret(p, this.#randomSecret());
    });
  }

  #secretMsg(m: Member, type: 'set_secret' | 'random_secret', body: Record<string, unknown>): HandleResult {
    if (this.phase !== 'SECRET' || m.seat === null || m.spectator)
      return fail('INVALID_STATE', '지금은 비밀 숫자를 정할 수 없습니다.');
    if (m.secret) return fail('INVALID_STATE', '이미 비밀 숫자를 정했습니다.');
    let digits: string;
    if (type === 'random_secret') digits = this.#randomSecret();
    else {
      if (!bulls.isValidNumber(body.digits, this.opts.digits))
        return fail('INVALID_GUESS', MESSAGES.INVALID_GUESS);
      digits = body.digits;
    }
    this.#setSecret(m, digits);
    return OK;
  }

  #setSecret(m: Member, digits: string): void {
    if (this.phase !== 'SECRET' || m.secret) return;
    m.secret = digits;
    m.view.secretSet = true;
    this.io.sendTo(m.id, 'your_secret', { digits });
    const players = this.#players();
    if (players.length === bulls.BULLS_PLAYERS && players.every((p) => p.secret)) this.#beginPlay();
  }

  #beginPlay(): void {
    this.clearPhaseTimer();
    const [a, b] = this.#players().sort((x, y) => (x.seat ?? 0) - (y.seat ?? 0));
    if (!a || !b) return;
    this.#game = bulls.startBulls(this.opts.digits, this.opts.maxAttempts, [a.secret, b.secret]);
    this.setPhase('PLAYING');
    this.state.phaseEndsAt = 0;
    this.#startTurn();
  }

  // ───────────────────────── 추측 ─────────────────────────

  #startTurn(): void {
    this.clearTurnTimers();
    const g = this.#game;
    if (!g || g.over) return;
    const player = this.#bySeat(g.turn);
    if (!player) return;
    this.#turnId = this.rng.id();
    const deadline = this.scheduler.now() + this.opts.turnSeconds * this.timing.msPerTurnSecond;
    this.state.currentTurn = player.id;
    this.state.turnId = this.#turnId;
    this.state.deadline = deadline;
    this.state.lastChance = g.lastChance;
    this.io.broadcast('turn_start', {
      playerId: player.id,
      turnId: this.#turnId,
      deadline,
      serverNow: this.scheduler.now(),
      lastChance: g.lastChance,
    });
    const turnId = this.#turnId;
    this.setTurnTimer(deadline - this.scheduler.now(), () => this.#onTimeout(turnId));
    if (player.controller !== 'human') this.#scheduleBot(turnId);
  }

  /** B-31, B-32: 그 턴을 넘긴다 (시도 1회). 2번 연속이면 봇이 대신 */
  #onTimeout(turnId: string): void {
    const g = this.#game;
    if (!g || this.phase !== 'PLAYING' || turnId !== this.#turnId) return;
    const m = this.#bySeat(g.turn);
    if (!m) return;
    if (m.controller === 'human') {
      m.consecutiveTimeouts += 1;
      if (m.consecutiveTimeouts >= 2) {
        m.controller = 'autopilot';
        m.view.autopilot = true;
      }
    }
    this.#skipped += 1;
    this.#apply(m, bulls.skipTurn(g, g.turn), true);
  }

  #scheduleBot(turnId: string): void {
    this.setBotTimer(() => {
      const g = this.#game;
      if (!g || this.phase !== 'PLAYING' || this.#turnId !== turnId) return;
      const m = this.#bySeat(g.turn);
      if (!m || m.controller === 'human') return;
      // B-35: 자기 추측 기록만 쓴다 (상대 비밀 숫자는 보지 않는다)
      const own = g.history.filter((r) => r.seat === g.turn);
      const digits = bulls.botGuess(g.digits, own, (n) => this.rng.int(n));
      this.#apply(m, bulls.guessNumber(g, g.turn, digits), true);
    });
  }

  /** BE-01~BE-03 */
  #guess(m: Member, body: Record<string, unknown>): HandleResult {
    const g = this.#game;
    if (!g || this.phase !== 'PLAYING') return fail('INVALID_STATE', '게임 중이 아닙니다.');
    if (m.spectator || m.seat === null || m.controller === 'bot' || g.turn !== m.seat)
      return fail('NOT_YOUR_TURN', '내 차례가 아닙니다.');
    if (body.turnId !== this.#turnId) return fail('STALE_TURN', '이미 지난 차례입니다.');
    const result = bulls.guessNumber(g, m.seat, body.digits);
    if (!result.ok) return fail(result.code, MESSAGES[result.code]);
    m.consecutiveTimeouts = 0;
    if (m.controller === 'autopilot') {
      m.controller = 'human';
      m.view.autopilot = false;
    }
    this.#apply(m, result, false);
    return OK;
  }

  #apply(m: Member, result: bulls.BullsResult, isAuto: boolean): void {
    if (!result.ok) return;
    this.clearTurnTimers();
    const before = this.#game;
    this.#game = result.state;
    const r = result.record;
    const attempt = result.state.attempts[r.seat];
    m.view.attempts = attempt;
    this.state.history.push(
      new BullsGuessState({
        playerId: m.id,
        guess: r.guess ?? '',
        strikes: r.strikes,
        balls: r.balls,
        skipped: r.guess === null,
        isAuto: isAuto || m.controller !== 'human',
      }),
    );
    if (r.guess === null) this.io.broadcast('turn_skipped', { playerId: m.id, attempt });
    else
      this.io.broadcast('guess_result', {
        playerId: m.id,
        guess: r.guess,
        strikes: r.strikes,
        balls: r.balls,
        attempt,
        isAuto: isAuto || m.controller !== 'human',
      });
    if (result.state.lastChance && !before?.lastChance) {
      this.#hadLastChance = true;
      const second = this.#bySeat(1);
      if (second) this.io.broadcast('last_chance', { playerId: second.id });
    }
    if (result.state.over) {
      this.#finish();
      return;
    }
    this.#startTurn();
  }

  // ───────────────────────── 끝 / 리매치 ─────────────────────────

  #finish(): void {
    const g = this.#game;
    if (!g || !g.result) return;
    this.clearTurnTimers();
    const winner = g.winner === null ? undefined : this.#bySeat(g.winner);
    this.state.currentTurn = '';
    this.state.turnId = '';
    this.state.deadline = 0;
    this.state.lastChance = false;
    this.state.result = g.result;
    this.state.winnerId = winner?.id ?? '';
    const players = this.#players();
    // B-23: 끝나면 두 비밀 숫자를 공개한다
    for (const p of players) p.view.revealed = p.secret;
    this.setPhase('GAME_OVER');
    this.io.broadcast('game_over', {
      result: g.result,
      winnerId: winner?.id ?? null,
      secrets: Object.fromEntries(players.map((p) => [p.id, p.secret])),
      attempts: Object.fromEntries(players.map((p) => [p.id, g.attempts[p.seat ?? 0]])),
    });
    this.io.onFinished?.({
      gameId: this.#gameId,
      roomCode: this.state.roomCode,
      startedAt: this.#startedAt,
      endedAt: new Date(this.scheduler.now()),
      options: this.opts,
      players: players.map((p) => ({
        guestId: p.guestId,
        nickname: p.nickname,
        seat: p.seat ?? 0,
        attempts: g.attempts[p.seat ?? 0],
        isBot: p.originallyBot,
        replaced: this.replacedIds.has(p.id),
      })),
      result: g.result,
      winnerSeat: g.winner,
      lastChance: this.#hadLastChance,
      skippedTurns: this.#skipped,
    });
  }

  // ───────────────────────── 보조 ─────────────────────────

  #randomSecret(): string {
    return bulls.randomNumber(this.opts.digits, (n) => this.rng.int(n));
  }

  /** 자리에 앉은 두 사람 (게임 중) */
  #players(): Member[] {
    return [...this.members.values()].filter((m) => !m.spectator && m.seat !== null);
  }

  #bySeat(seat: Seat): Member | undefined {
    return this.#players().find((m) => m.seat === seat);
  }
}
