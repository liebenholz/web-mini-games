import {
  DEFAULT_BOT_PARAMS,
  DEFAULT_RULE_OPTIONS,
  aliveSeats,
  applyLoss,
  botDecide,
  canCallLiar,
  createTable,
  findPlayer,
  isGameOver,
  isValidBid,
  minimumRaise,
  nextStarter,
  nextTurnSeat,
  parseRoomOptions,
  ranking,
  resolveLiar,
  totalDice,
  type Bid,
  type BidFace,
  type BotParams,
  type DieFace,
  type GamePhase,
  type PlayerDice,
  type RoomOptions,
  type RoundResult,
  type ServerMessageType,
  type ServerMessages,
  type TableState,
} from '@wmg/rules';
import {
  fail,
  LobbyMatch,
  OK,
  type HandleResult,
  type LobbyIO,
  type LobbyMember,
  type LobbyTextKey,
  type NewView,
} from '../../framework/game/LobbyMatch.js';
import { rollDie, type Rng } from '../../framework/rng.js';
import type { Scheduler } from '../../framework/scheduler.js';
import type { BidRecord, GameRecord, RoundRecord } from '../../persistence/types.js';
import { BidState, LiarsDiceState, PlayerState } from './state.js';

export interface Timing {
  /** STARTING 카운트다운 (명세 5장: 3초) */
  readonly startCountdownMs: number;
  /** REVEAL 공개 연출 (명세 5장: 3초) */
  readonly revealMs: number;
  /** S-12: 봇 지연 1~3초 */
  readonly botDelayMinMs: number;
  readonly botDelayMaxMs: number;
  /** 턴 제한 시간 1초당 실제 ms. 운영은 1000. 테스트에서만 줄인다 */
  readonly msPerTurnSecond: number;
}

export const DEFAULT_TIMING: Timing = Object.freeze({
  startCountdownMs: 3000,
  revealMs: 3000,
  botDelayMinMs: 1000,
  botDelayMaxMs: 3000,
  msPerTurnSecond: 1000,
});

/** S-10 미결정: 사람 1명 + 봇만 남았을 때. 기본은 계속 진행 */
export type AloneWithBotsPolicy = 'continue' | 'end';

export const SPECTATOR_LIMIT = 20;

export interface MatchIO extends LobbyIO {
  broadcast<T extends ServerMessageType>(type: T, payload: ServerMessages[T] & Envelope): void;
  sendTo<T extends ServerMessageType>(playerId: string, type: T, payload: ServerMessages[T] & Envelope): void;
  /** 판이 정상적으로 끝났을 때 한 번 호출된다 (M3 저장) */
  onRecord(record: GameRecord): void;
}

interface Envelope {
  readonly roomId: string;
  readonly roundNo: number;
  readonly seq: number;
}

export interface MatchDeps {
  readonly io: MatchIO;
  readonly rng: Rng;
  readonly scheduler: Scheduler;
  readonly timing?: Timing;
  readonly botParams?: BotParams;
  readonly alonePolicy?: AloneWithBotsPolicy;
}

export type { HandleResult, JoinResult } from '../../framework/game/LobbyMatch.js';

interface Member extends LobbyMember<PlayerState> {
  consecutiveTimeouts: number;
  seat: number;
  /** 비공개. 공유 상태에 넣지 않는다 (S-01) */
  dice: DieFace[];
}

const IN_GAME: ReadonlySet<GamePhase> = new Set(['STARTING', 'ROLLING', 'BIDDING', 'REVEAL', 'RESOLVE']);

const TEXT: Partial<Record<LobbyTextKey, string>> = {
  alreadyStarted: '이미 게임이 진행 중입니다.',
  notAllReady: '모든 참가자가 준비해야 합니다.',
  rematchNotOver: '게임이 끝난 뒤에만 리매치할 수 있습니다.',
  rematchAbsent: '방에 참가하고 있지 않습니다.',
};

/**
 * 거짓말쟁이 주사위 한 방의 게임 진행 (명세 5장 상태 머신).
 * 대기실·좌석·이탈·리매치는 LobbyMatch(ADR 0003)가 하고, 여기서는 라운드(굴리기, 선언, 라이어, 공개, 판정),
 * 시간 초과 자동 행동(S-06, S-07), 봇(S-11), 정보 은닉(S-01), 메시지 순서 정보(명세 6장)를 맡는다.
 */
export class LiarsDiceMatch extends LobbyMatch<RoomOptions, PlayerState, Member, LiarsDiceState, MatchIO> {
  readonly #botParams: BotParams;
  readonly #alonePolicy: AloneWithBotsPolicy;
  #bySeat = new Map<number, Member>();
  #seq = 0;

  #table: TableState | null = null;
  #currentBid: Bid | null = null;
  #lastBidderSeat = -1;
  #turnSeat = -1;
  #turnId = '';
  #roundStarterSeat = -1;
  #firstStarter = 0;
  #lastReveal: ServerMessages['reveal'] | null = null;

  #gameId = '';
  #startedAt = new Date(0);
  #roundLog: RoundRecord[] = [];
  #bidLog: BidRecord[] = [];

  constructor(roomCode: string, options: RoomOptions, deps: MatchDeps) {
    super(new LiarsDiceState(), roomCode, options, {
      io: deps.io,
      rng: deps.rng,
      scheduler: deps.scheduler,
      timing: deps.timing ?? DEFAULT_TIMING,
    });
    this.#botParams = deps.botParams ?? DEFAULT_BOT_PARAMS;
    this.#alonePolicy = deps.alonePolicy ?? 'continue';
    this.writeOptions();
    // 방을 만들 때 매칭 목록 노출 여부를 항상 한 번 알린다 (빠른 매칭이 이 게임에만 있다)
    this.listed = null;
    this.updateListing();
  }

  override get phase(): GamePhase {
    return this.state.phase as GamePhase;
  }

  /** 테스트·진단용: 좌석별 비공개 주사위 (네트워크로 보내지 않는다) */
  peekDice(playerId: string): readonly DieFace[] {
    return this.members.get(playerId)?.dice ?? [];
  }

  playerIdForGuest(guestId: string): string | undefined {
    return this.byGuest.get(guestId);
  }

  // ───────────────────────── 대기실 훅 ─────────────────────────

  protected maxSeats(): number {
    return this.opts.maxPlayers;
  }

  protected spectatorLimit(): number {
    return SPECTATOR_LIMIT;
  }

  protected override lobbyText(key: LobbyTextKey): string {
    return TEXT[key] ?? super.lobbyText(key);
  }

  protected override notEnoughPlayersMessage(): string {
    return '최소 2명이 필요합니다.';
  }

  protected override checkOptions(next: RoomOptions): string | null {
    return next.maxPlayers < this.seated().length ? '현재 인원보다 최대 인원을 작게 할 수 없습니다.' : null;
  }

  /** 리매치: 앉아 있던 사람은 그대로, 관전자는 자리가 남으면 입장 순서대로 참가자가 된다 */
  protected override rematchOrder(a: Member, b: Member): number {
    return Number(a.spectator) - Number(b.spectator) || a.joinOrder - b.joinOrder;
  }

  protected createView(init: NewView): PlayerState {
    return new PlayerState({ ...init });
  }

  protected createMember(base: LobbyMember<PlayerState>): Member {
    return { ...base, consecutiveTimeouts: 0, seat: -1, dice: [] };
  }

  protected parseOptions(input: unknown): { ok: true; options: RoomOptions } | { ok: false } {
    return parseRoomOptions(input, this.opts);
  }

  protected writeOptions(): void {
    Object.assign(this.state.options, this.opts);
  }

  protected isPlaying(): boolean {
    return IN_GAME.has(this.phase);
  }

  protected isGameOver(): boolean {
    return this.phase === 'GAME_OVER';
  }

  /** 이 게임은 끊김·이탈을 따로 알리지 않는다 (공유 상태의 connected, isBot으로 보인다) */
  protected notifyReplaced(): void {}

  /** S-10: 게임 중이면 봇이 남은 주사위를 이어받는다 */
  protected onSeatTakenOver(m: Member): void {
    m.view.autopilot = false;
    if (m.seat === this.#turnSeat && this.phase === 'BIDDING') this.#scheduleBot(this.#turnId);
  }

  /** S-09: 복귀하면 본인 주사위와 진행 정보를 다시 보낸다 (공유 상태는 Colyseus가 전체 전송) */
  resendPrivate(playerId: string): void {
    const m = this.members.get(playerId);
    if (!m) return;
    if (m.dice.length > 0 && !m.spectator && (this.phase === 'BIDDING' || this.phase === 'ROLLING')) {
      this.#sendTo(m.id, 'your_dice', { dice: [...m.dice] });
    }
    if (this.phase === 'BIDDING') {
      const current = this.#bySeat.get(this.#turnSeat);
      if (current) {
        this.#sendTo(m.id, 'turn_start', {
          playerId: current.id,
          turnId: this.#turnId,
          deadline: this.state.deadline,
          serverNow: this.scheduler.now(),
        });
      }
    }
    // E-08: 공개 연출 중 끊겼다면 판정 결과를 다시 보낸다
    if ((this.phase === 'REVEAL' || this.phase === 'RESOLVE') && this.#lastReveal) {
      this.#sendTo(m.id, 'reveal', this.#lastReveal);
    }
  }

  protected handleGame(m: Member, type: string, body: Record<string, unknown>): HandleResult {
    if (type === 'bid') return this.#bid(m, body);
    if (type === 'call_liar') return this.#callLiar(m, body);
    return fail('INVALID_MESSAGE', '알 수 없는 요청입니다.');
  }

  protected resetMemberForRematch(m: Member): void {
    m.consecutiveTimeouts = 0;
    m.dice = [];
    m.seat = -1;
    Object.assign(m.view, { seat: -1, autopilot: false, diceCount: 0, eliminated: false, rank: 0 });
  }

  protected resetGameForRematch(): void {
    this.#table = null;
    this.#bySeat.clear();
    this.#currentBid = null;
    this.#lastReveal = null;
    this.state.bids.clear();
    this.state.roundNo = 0;
    this.state.totalDice = 0;
    if (!this.state.hostId) {
      const next = this.earliestHuman();
      if (next) this.setHost(next);
    }
  }

  /** E-10 + S-10 미결정: 'end'로 설정하면 사람 1명 + 봇만 남았을 때 종료한다 */
  protected override checkAbandoned(): void {
    super.checkAbandoned();
    if (this.disposed || this.#alonePolicy !== 'end' || !IN_GAME.has(this.phase)) return;
    const seatedHumans = [...this.members.values()].filter(
      (m) => m.present && m.controller !== 'bot' && !m.spectator,
    );
    if (seatedHumans.length !== 1) return;
    if (this.seated().every((m) => m.controller === 'bot' || m === seatedHumans[0])) {
      this.dispose();
      this.io.onAbandoned();
    }
  }

  // ───────────────────────── 시작 ─────────────────────────

  /** 시작을 누르면 바로 좌석과 판을 정한다 (R-02). 첫 선은 무작위 (R-03) */
  protected override onStarting(): void {
    const seated = this.seated().sort((a, b) => a.joinOrder - b.joinOrder);
    this.#bySeat.clear();
    seated.forEach((p, index) => {
      p.seat = index;
      p.view.seat = index;
      p.view.diceCount = this.opts.startingDice;
      p.view.eliminated = false;
      p.view.rank = 0;
      p.consecutiveTimeouts = 0;
      this.#bySeat.set(index, p);
    });
    this.#table = createTable(
      seated.map((p) => p.seat),
      this.opts.startingDice,
    );
    this.#gameId = this.rng.id();
    this.#startedAt = new Date(this.scheduler.now());
    this.replacedIds.clear();
    this.#roundLog = [];
    this.#bidLog = [];
    this.state.roundNo = 0;
    this.#firstStarter = this.rng.int(seated.length); // 좌석 번호 = 입장 순서 인덱스
  }

  protected beginGame(): void {
    this.#startRound(this.#firstStarter);
  }

  #checkTurn(m: Member, body: Record<string, unknown>): HandleResult {
    if (this.phase !== 'BIDDING') return fail('INVALID_STATE', '지금은 선언할 수 없습니다.');
    // E-06, E-07: 이미 처리된 턴의 입력은 turnId로 걸러낸다
    if (typeof body.turnId !== 'string' || body.turnId !== this.#turnId) {
      return fail('STALE_TURN', '이미 지나간 차례입니다.');
    }
    if (m.spectator || m.seat !== this.#turnSeat) return fail('NOT_YOUR_TURN', '내 차례가 아닙니다.'); // E-04
    return OK;
  }

  #bid(m: Member, body: Record<string, unknown>): HandleResult {
    const turn = this.#checkTurn(m, body);
    if (!turn.ok) return turn;
    const check = isValidBid(
      this.#currentBid,
      { quantity: body.quantity, face: body.face },
      this.state.totalDice,
    );
    if (!check.ok) return fail('INVALID_BID', '선언할 수 없는 값입니다.'); // E-01~E-03
    this.#regainControl(m);
    this.#applyBid(m, { quantity: body.quantity as number, face: body.face as BidFace }, false);
    return OK;
  }

  #callLiar(m: Member, body: Record<string, unknown>): HandleResult {
    const turn = this.#checkTurn(m, body);
    if (!turn.ok) return turn;
    const check = canCallLiar(this.#currentBid);
    if (!check.ok) return fail('NO_BID_TO_CALL', '첫 차례에는 라이어를 외칠 수 없습니다.'); // E-05
    this.#regainControl(m);
    this.#applyLiar(m);
    return OK;
  }

  // ───────────────────────── 라운드 ─────────────────────────

  #startRound(starterSeat: number): void {
    const table = this.#requireTable();
    this.setPhase('ROLLING');
    this.state.roundNo += 1;
    this.state.phaseEndsAt = 0;
    this.#currentBid = null;
    this.#lastBidderSeat = -1;
    this.#lastReveal = null;
    this.#roundStarterSeat = starterSeat;
    this.state.bids.clear();
    this.state.totalDice = totalDice(table);
    // S-03: 생존자 주사위를 동시에 굴리고 각자에게만 보낸다 (S-01)
    for (const p of this.seated()) {
      const count = findPlayer(table, p.seat)?.diceCount ?? 0;
      p.dice = Array.from({ length: count }, () => rollDie(this.rng));
    }
    for (const p of this.seated()) {
      if (p.dice.length > 0) this.#sendTo(p.id, 'your_dice', { dice: [...p.dice] });
    }
    this.setPhase('BIDDING');
    this.#startTurn(starterSeat);
  }

  #startTurn(seat: number): void {
    this.clearTurnTimers();
    const m = this.#seatMember(seat);
    const now = this.scheduler.now();
    const duration = this.opts.turnSeconds * this.timing.msPerTurnSecond;
    this.#turnSeat = seat;
    this.#turnId = this.rng.id();
    this.state.currentTurn = m.id;
    this.state.turnId = this.#turnId;
    this.state.deadline = now + duration; // S-05: 서버 시간 기준
    this.#broadcast('turn_start', {
      playerId: m.id,
      turnId: this.#turnId,
      deadline: now + duration,
      serverNow: now,
    });
    const turnId = this.#turnId;
    this.setTurnTimer(duration, () => this.#onTimeout(turnId));
    if (m.controller !== 'human') this.#scheduleBot(turnId);
  }

  #scheduleBot(turnId: string): void {
    const { botDelayMinMs: min, botDelayMaxMs: max } = this.timing;
    const turnMs = this.opts.turnSeconds * this.timing.msPerTurnSecond;
    // 봇 지연은 턴 시간을 넘지 않게 자른다
    const delay = Math.min(min + this.rng.int(Math.max(1, max - min + 1)), Math.max(0, turnMs - 1));
    this.setBotTimer(() => {
      if (turnId !== this.#turnId || this.phase !== 'BIDDING') return;
      const m = this.#bySeat.get(this.#turnSeat);
      if (!m || m.controller === 'human') return;
      // S-12: 봇은 자기 주사위와 공개 정보만 본다
      const decision = botDecide(
        m.dice,
        { currentBid: this.#currentBid, totalDice: this.state.totalDice },
        this.#botParams,
      );
      if (decision.type === 'bid') this.#applyBid(m, decision.bid, m.controller === 'autopilot');
      else this.#applyLiar(m);
    }, delay);
  }

  /** S-06, S-07: 시간 초과 자동 행동. 2연속이면 봇이 대신 플레이한다 */
  #onTimeout(turnId: string): void {
    if (turnId !== this.#turnId || this.phase !== 'BIDDING') return;
    const m = this.#seatMember(this.#turnSeat);
    if (m.controller === 'human') {
      m.consecutiveTimeouts += 1;
      if (m.consecutiveTimeouts >= 2) {
        m.controller = 'autopilot';
        m.view.autopilot = true;
      }
    }
    const raise = minimumRaise(this.#currentBid, this.state.totalDice);
    if (raise) this.#applyBid(m, raise, true);
    else this.#applyLiar(m);
  }

  #regainControl(m: Member): void {
    m.consecutiveTimeouts = 0;
    if (m.controller === 'autopilot') {
      m.controller = 'human';
      m.view.autopilot = false;
    }
  }

  #applyBid(m: Member, bid: Bid, isAuto: boolean): void {
    this.clearTurnTimers();
    this.#currentBid = bid;
    this.#lastBidderSeat = m.seat;
    this.state.bids.push(new BidState({ playerId: m.id, quantity: bid.quantity, face: bid.face, isAuto }));
    this.#bidLog.push({
      roundNo: this.state.roundNo,
      seq: this.#bidLog.length + 1,
      seat: m.seat,
      quantity: bid.quantity,
      face: bid.face,
      isAuto,
      createdAt: new Date(this.scheduler.now()),
    });
    this.#broadcast('bid_made', { playerId: m.id, quantity: bid.quantity, face: bid.face, isAuto });
    this.#startTurn(nextTurnSeat(m.seat, aliveSeats(this.#requireTable())));
  }

  #applyLiar(caller: Member): void {
    this.clearTurnTimers();
    const bid = this.#currentBid;
    if (bid === null) throw new Error('liar without a bid'); // canCallLiar가 먼저 막는다
    const bidder = this.#seatMember(this.#lastBidderSeat);
    this.#broadcast('liar_called', { caller: caller.id, target: bidder.id });
    this.setPhase('REVEAL');
    this.state.currentTurn = '';
    this.state.turnId = '';
    this.state.deadline = 0;
    this.#turnId = '';
    this.#turnSeat = -1;

    const alive = this.seated().filter((p) => p.dice.length > 0);
    const allDice: PlayerDice[] = alive.map((p) => ({ seat: p.seat, dice: p.dice }));
    const result = resolveLiar(bid, allDice, bidder.seat, caller.seat, DEFAULT_RULE_OPTIONS);
    const loser = this.#seatMember(result.loserSeat);
    this.#lastReveal = {
      dice: alive.map((p) => ({ playerId: p.id, seat: p.seat, dice: [...p.dice] })),
      bid,
      actual: result.actual,
      bidSucceeded: result.bidSucceeded,
      loserId: loser.id,
    };
    this.#broadcast('reveal', this.#lastReveal);
    this.#roundLog.push({
      roundNo: this.state.roundNo,
      starterSeat: this.#roundStarterSeat,
      dice: allDice.map((d) => ({ seat: d.seat, dice: [...d.dice] })),
      result: { ...result, bid: { quantity: bid.quantity, face: bid.face } },
    });
    this.state.phaseEndsAt = this.scheduler.now() + this.timing.revealMs;
    this.setPhaseTimer(this.timing.revealMs, () => this.#resolve(result));
  }

  #resolve(result: RoundResult): void {
    this.setPhase('RESOLVE');
    this.state.phaseEndsAt = 0;
    const table = applyLoss(this.#requireTable(), result.loserSeat);
    this.#table = table;
    const loser = this.#seatMember(result.loserSeat);
    const after = findPlayer(table, loser.seat);
    if (!after) throw new Error(`seat ${loser.seat} missing from table`);
    loser.view.diceCount = after.diceCount;
    this.#broadcast('dice_lost', { playerId: loser.id, diceCount: after.diceCount });
    for (const p of this.seated()) p.dice = [];
    if (after.eliminationOrder !== null) {
      // R-12, R-13
      const rank = table.players.length - after.eliminationOrder + 1;
      loser.view.eliminated = true;
      loser.view.rank = rank;
      this.#broadcast('player_eliminated', { playerId: loser.id, rank });
    }
    this.state.totalDice = totalDice(table);
    if (isGameOver(table)) {
      this.#finishGame();
      return;
    }
    this.#startRound(nextStarter(result.loserSeat, aliveSeats(table))); // R-04
  }

  #finishGame(): void {
    const table = this.#requireTable();
    this.setPhase('GAME_OVER');
    this.clearTurnTimers();
    this.state.currentTurn = '';
    this.state.turnId = '';
    this.state.deadline = 0;
    const ranks = ranking(table);
    const entries = ranks.map((r) => {
      const m = this.#seatMember(r.seat);
      const rank = r.rank ?? 1;
      m.view.rank = rank;
      return {
        playerId: m.id,
        nickname: m.nickname,
        seat: m.seat,
        rank,
        isBot: m.controller === 'bot',
        member: m,
      };
    });
    this.#broadcast('game_over', {
      ranking: entries.map(({ playerId, nickname, seat, rank, isBot }) => ({
        playerId,
        nickname,
        seat,
        rank,
        isBot,
      })),
    });
    this.updateListing();
    this.io.onRecord({
      gameId: this.#gameId,
      roomCode: this.state.roomCode,
      options: this.opts,
      startedAt: this.#startedAt,
      endedAt: new Date(this.scheduler.now()),
      endReason: 'completed',
      players: entries.map(({ member, rank }) => ({
        guestId: member.guestId,
        nickname: member.nickname,
        seat: member.seat,
        isBot: member.originallyBot,
        replaced: this.replacedIds.has(member.id),
        finalRank: rank,
      })),
      rounds: this.#roundLog,
      bids: this.#bidLog,
    });
  }

  // ───────────────────────── 보조 ─────────────────────────

  #seatMember(seat: number): Member {
    const m = this.#bySeat.get(seat);
    if (!m) throw new Error(`no member at seat ${seat}`);
    return m;
  }

  #requireTable(): TableState {
    if (!this.#table) throw new Error('table not initialised');
    return this.#table;
  }

  /** 명세 6장: 모든 서버 메시지의 순서 정보. seq는 방 단위로 증가한다 */
  envelope(): Envelope {
    return { roomId: this.state.roomCode, roundNo: this.state.roundNo, seq: (this.#seq += 1) };
  }

  #broadcast<T extends ServerMessageType>(type: T, payload: ServerMessages[T]): void {
    this.io.broadcast(type, { ...payload, ...this.envelope() });
  }

  #sendTo<T extends ServerMessageType>(playerId: string, type: T, payload: ServerMessages[T]): void {
    this.io.sendTo(playerId, type, { ...payload, ...this.envelope() });
  }
}
