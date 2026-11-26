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
  normalizeNickname,
  parseRoomOptions,
  ranking,
  resolveLiar,
  totalDice,
  type Bid,
  type BidFace,
  type BotParams,
  type DieFace,
  type ErrorCode,
  type GamePhase,
  type PlayerDice,
  type RoomOptions,
  type RoundResult,
  type ServerMessageType,
  type ServerMessages,
  type TableState,
} from '@wmg/rules';
import type { Rng } from '../../framework/rng.js';
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

export interface MatchIO {
  broadcast<T extends ServerMessageType>(type: T, payload: ServerMessages[T] & Envelope): void;
  sendTo<T extends ServerMessageType>(playerId: string, type: T, payload: ServerMessages[T] & Envelope): void;
  /** 판이 정상적으로 끝났을 때 한 번 호출된다 (M3 저장) */
  onRecord(record: GameRecord): void;
  /** E-10: 사람이 모두 나갔다. 방을 닫는다 (전적 미기록) */
  onAbandoned(): void;
  /** 랜덤 매칭 목록 노출 여부가 바뀌었다 */
  onListingChange(listed: boolean): void;
  /** 방장이 이 참가자를 내보냈다. 연결을 KICKED로 닫는다 */
  onKick(playerId: string): void;
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

type Controller = 'human' | 'autopilot' | 'bot';

interface Member {
  readonly id: string;
  /** 사람이면 게스트 ID. 처음부터 봇이면 null. 이탈 후 봇이 이어받아도 기록용으로 남긴다 */
  readonly guestId: string | null;
  readonly nickname: string;
  readonly joinOrder: number;
  readonly originallyBot: boolean;
  controller: Controller;
  /** 사람이 방 안에 있거나 재접속 대기 중 */
  present: boolean;
  spectator: boolean;
  ready: boolean;
  consecutiveTimeouts: number;
  seat: number;
  /** 비공개. 공유 상태에 넣지 않는다 (S-01) */
  dice: DieFace[];
  readonly view: PlayerState;
}

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

const OK: HandleResult = { ok: true };
const fail = (code: ErrorCode, message: string): HandleResult => ({ ok: false, code, message });

const IN_GAME: ReadonlySet<GamePhase> = new Set(['STARTING', 'ROLLING', 'BIDDING', 'REVEAL', 'RESOLVE']);

/**
 * 거짓말쟁이 주사위 한 방의 게임 진행 (명세 5장 상태 머신).
 * Colyseus와 분리해서 가상 시간으로 테스트할 수 있게 한다. 방 어댑터는 메시지를 넘기고 결과를 전달만 한다.
 */
export class LiarsDiceMatch {
  readonly state = new LiarsDiceState();

  readonly #io: MatchIO;
  readonly #rng: Rng;
  readonly #scheduler: Scheduler;
  readonly #timing: Timing;
  readonly #botParams: BotParams;
  readonly #alonePolicy: AloneWithBotsPolicy;

  #options: RoomOptions;
  #members = new Map<string, Member>();
  /** 방장이 내보낸 게스트 ID. 방이 끝날 때까지 다시 들어올 수 없다 */
  readonly #kicked = new Set<string>();
  #byGuest = new Map<string, string>();
  #bySeat = new Map<number, Member>();
  #joinCounter = 0;
  #botCounter = 0;
  #seq = 0;
  #listed: boolean | null = null;

  #table: TableState | null = null;
  #currentBid: Bid | null = null;
  #lastBidderSeat = -1;
  #turnSeat = -1;
  #turnId = '';
  #roundStarterSeat = -1;
  #lastReveal: ServerMessages['reveal'] | null = null;
  #cancelTurn: (() => void) | null = null;
  #cancelBot: (() => void) | null = null;
  #cancelPhase: (() => void) | null = null;

  #gameId = '';
  #startedAt = new Date(0);
  /** ST-08: 이번 판에서 봇이 자리를 이어받은 사람 (돌아와도 남긴다) */
  readonly #replacedIds = new Set<string>();
  #roundLog: RoundRecord[] = [];
  #bidLog: BidRecord[] = [];
  #disposed = false;

  constructor(roomCode: string, options: RoomOptions, deps: MatchDeps) {
    this.#io = deps.io;
    this.#rng = deps.rng;
    this.#scheduler = deps.scheduler;
    this.#timing = deps.timing ?? DEFAULT_TIMING;
    this.#botParams = deps.botParams ?? DEFAULT_BOT_PARAMS;
    this.#alonePolicy = deps.alonePolicy ?? 'continue';
    this.#options = options;
    this.state.roomCode = roomCode;
    this.#syncOptions();
    this.#updateListing();
  }

  get phase(): GamePhase {
    return this.state.phase as GamePhase;
  }

  get options(): RoomOptions {
    return this.#options;
  }

  /** 테스트·진단용: 좌석별 비공개 주사위 (네트워크로 보내지 않는다) */
  peekDice(playerId: string): readonly DieFace[] {
    return this.#members.get(playerId)?.dice ?? [];
  }

  playerIdForGuest(guestId: string): string | undefined {
    return this.#byGuest.get(guestId);
  }

  // ───────────────────────── 입장 / 퇴장 ─────────────────────────

  join(guestId: string, rawNickname: unknown): JoinResult {
    if (this.#kicked.has(guestId)) return { ok: false, code: 'KICKED' };
    const existingId = this.#byGuest.get(guestId);
    const existing = existingId ? this.#members.get(existingId) : undefined;
    if (existing && existing.present) {
      // E-13 또는 재접속 대기 중 다른 탭에서 복귀: 같은 자리를 이어간다
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
      if (this.#seated().length >= this.#options.maxPlayers) return { ok: false, code: 'ROOM_FULL' };
    } else {
      // E-11: 게임 중(결과 화면 포함) 입장은 관전자
      if (this.#spectators().length >= SPECTATOR_LIMIT) return { ok: false, code: 'ROOM_FULL' };
      spectator = true;
    }

    const member = this.#addMember({ guestId, nickname, bot: false, spectator });
    if (!this.state.hostId) this.#setHost(member);
    this.#updateListing();
    return { ok: true, playerId: member.id, role: spectator ? 'spectator' : 'player', reclaimed: false };
  }

  /** S-08: 연결 끊김. 자리는 유지하고 차례가 오면 S-06 자동 행동을 한다 */
  disconnect(playerId: string): void {
    const m = this.#members.get(playerId);
    if (!m) return;
    m.view.connected = false;
  }

  /** S-09: 복귀하면 본인 주사위와 진행 정보를 다시 보낸다 (공유 상태는 Colyseus가 전체 전송) */
  reconnect(playerId: string): void {
    const m = this.#members.get(playerId);
    if (!m || !m.present) return;
    m.view.connected = true;
    this.resendPrivate(playerId);
  }

  resendPrivate(playerId: string): void {
    const m = this.#members.get(playerId);
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
          serverNow: this.#scheduler.now(),
        });
      }
    }
    // E-08: 공개 연출 중 끊겼다면 판정 결과를 다시 보낸다
    if ((this.phase === 'REVEAL' || this.phase === 'RESOLVE') && this.#lastReveal) {
      this.#sendTo(m.id, 'reveal', this.#lastReveal);
    }
  }

  /**
   * 사람이 방을 떠났다 (스스로 나감 또는 재접속 60초 초과).
   * S-10: 게임 중이면 봇이 남은 주사위를 이어받는다.
   */
  leave(playerId: string): void {
    const m = this.#members.get(playerId);
    if (!m || m.controller === 'bot') return;
    if (m.guestId) this.#byGuest.delete(m.guestId);

    if (m.spectator || this.phase === 'WAITING') {
      this.#removeMember(m);
    } else if (this.phase === 'GAME_OVER') {
      m.present = false;
      m.view.connected = false;
    } else {
      m.present = false;
      if (!m.originallyBot) this.#replacedIds.add(m.id);
      m.controller = 'bot';
      m.view.isBot = true;
      m.view.autopilot = false;
      m.view.connected = true;
      if (m.seat === this.#turnSeat && this.phase === 'BIDDING') this.#scheduleBot(this.#turnId);
    }

    if (this.state.hostId === m.id) {
      m.view.isHost = false;
      this.state.hostId = '';
      const next = this.#earliestHuman();
      if (next) this.#setHost(next);
    }
    this.#updateListing();
    this.#checkAbandoned();
  }

  // ───────────────────────── 메시지 처리 ─────────────────────────

  handle(playerId: string, type: string, payload: unknown): HandleResult {
    const m = this.#members.get(playerId);
    if (!m || this.#disposed) return fail('INVALID_STATE', '방에 참가하고 있지 않습니다.');
    const body = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
    switch (type) {
      case 'set_ready':
        return this.#setReady(m, body);
      case 'set_options':
        return this.#setOptions(m, body);
      case 'add_bot':
        return this.#addBot(m);
      case 'remove_bot':
        return this.#removeBot(m, body);
      case 'kick_player':
        return this.#kickPlayer(m, body);
      case 'start_game':
        return this.#startGame(m);
      case 'bid':
        return this.#bid(m, body);
      case 'call_liar':
        return this.#callLiar(m, body);
      case 'rematch':
        return this.#rematch(m);
      default:
        return fail('INVALID_MESSAGE', '알 수 없는 요청입니다.');
    }
  }

  #setReady(m: Member, body: Record<string, unknown>): HandleResult {
    if (this.phase !== 'WAITING') return fail('INVALID_STATE', '대기실에서만 준비할 수 있습니다.');
    if (typeof body.ready !== 'boolean') return fail('INVALID_MESSAGE', '잘못된 요청입니다.');
    if (m.spectator) return fail('INVALID_STATE', '관전자는 준비할 수 없습니다.');
    m.ready = body.ready;
    m.view.ready = body.ready;
    return OK;
  }

  #setOptions(m: Member, body: Record<string, unknown>): HandleResult {
    if (this.phase !== 'WAITING') return fail('INVALID_STATE', '대기실에서만 옵션을 바꿀 수 있습니다.');
    if (this.state.hostId !== m.id) return fail('NOT_HOST', '방장만 옵션을 바꿀 수 있습니다.');
    const parsed = parseRoomOptions(body.options, this.#options);
    if (!parsed.ok) return fail('INVALID_OPTIONS', '옵션 값이 올바르지 않습니다.');
    if (parsed.options.maxPlayers < this.#seated().length) {
      return fail('INVALID_OPTIONS', '현재 인원보다 최대 인원을 작게 할 수 없습니다.');
    }
    this.#options = parsed.options;
    this.#syncOptions();
    this.#updateListing();
    return OK;
  }

  #addBot(m: Member): HandleResult {
    if (this.phase !== 'WAITING') return fail('INVALID_STATE', '대기실에서만 봇을 추가할 수 있습니다.');
    if (this.state.hostId !== m.id) return fail('NOT_HOST', '방장만 봇을 추가할 수 있습니다.');
    if (this.#seated().length >= this.#options.maxPlayers) return fail('ROOM_FULL', '자리가 없습니다.');
    this.#addBotMember();
    this.#updateListing();
    return OK;
  }

  #removeBot(m: Member, body: Record<string, unknown>): HandleResult {
    if (this.phase !== 'WAITING') return fail('INVALID_STATE', '대기실에서만 봇을 뺄 수 있습니다.');
    if (this.state.hostId !== m.id) return fail('NOT_HOST', '방장만 봇을 뺄 수 있습니다.');
    const target = typeof body.playerId === 'string' ? this.#members.get(body.playerId) : undefined;
    if (!target || !target.originallyBot) return fail('INVALID_MESSAGE', '봇을 찾을 수 없습니다.');
    this.#removeMember(target);
    this.#updateListing();
    return OK;
  }

  /** 방장이 대기실에서 사람 참가자를 내보낸다. 같은 게스트 ID는 이 방에 다시 들어올 수 없다 */
  #kickPlayer(m: Member, body: Record<string, unknown>): HandleResult {
    if (this.phase !== 'WAITING') return fail('INVALID_STATE', '대기실에서만 내보낼 수 있습니다.');
    if (this.state.hostId !== m.id) return fail('NOT_HOST', '방장만 내보낼 수 있습니다.');
    const target = typeof body.playerId === 'string' ? this.#members.get(body.playerId) : undefined;
    // 봇은 remove_bot으로 뺀다. 자기 자신은 내보낼 수 없다
    if (!target || target.originallyBot || target.id === m.id)
      return fail('INVALID_MESSAGE', '내보낼 참가자를 찾을 수 없습니다.');
    if (target.guestId) this.#kicked.add(target.guestId);
    this.#io.onKick(target.id);
    this.leave(target.id);
    return OK;
  }

  #startGame(m: Member): HandleResult {
    if (this.phase !== 'WAITING') return fail('INVALID_STATE', '이미 게임이 진행 중입니다.');
    if (this.state.hostId !== m.id) return fail('NOT_HOST', '방장만 시작할 수 있습니다.');
    const seated = this.#seated();
    // 방장은 시작 버튼을 누르는 것으로 준비한 것으로 본다
    if (seated.some((p) => p.controller === 'human' && p.id !== m.id && !p.ready)) {
      return fail('NOT_ALL_READY', '모든 참가자가 준비해야 합니다.');
    }
    const finalCount = this.#options.fillWithBots ? this.#options.maxPlayers : seated.length;
    if (finalCount < 2) return fail('NOT_ENOUGH_PLAYERS', '최소 2명이 필요합니다.');
    while (this.#seated().length < finalCount) this.#addBotMember();
    this.#beginStarting();
    return OK;
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

  #rematch(m: Member): HandleResult {
    if (this.phase !== 'GAME_OVER') return fail('INVALID_STATE', '게임이 끝난 뒤에만 리매치할 수 있습니다.');
    if (!m.present) return fail('INVALID_STATE', '방에 참가하고 있지 않습니다.');
    this.#resetToWaiting();
    return OK;
  }

  // ───────────────────────── 상태 머신 ─────────────────────────

  #beginStarting(): void {
    this.#setPhase('STARTING');
    const seated = this.#seated().sort((a, b) => a.joinOrder - b.joinOrder);
    this.#bySeat.clear();
    // R-02: 입장 순서대로 좌석 확정
    seated.forEach((p, index) => {
      p.seat = index;
      p.view.seat = index;
      p.view.diceCount = this.#options.startingDice;
      p.view.eliminated = false;
      p.view.rank = 0;
      p.consecutiveTimeouts = 0;
      this.#bySeat.set(index, p);
    });
    this.#table = createTable(
      seated.map((p) => p.seat),
      this.#options.startingDice,
    );
    this.#gameId = this.#rng.id();
    this.#startedAt = new Date(this.#scheduler.now());
    this.#replacedIds.clear();
    this.#roundLog = [];
    this.#bidLog = [];
    this.state.roundNo = 0;
    // R-03: 첫 선은 무작위
    const starter = this.#rng.int(seated.length); // 좌석 번호 = 입장 순서 인덱스
    this.state.phaseEndsAt = this.#scheduler.now() + this.#timing.startCountdownMs;
    this.#updateListing();
    this.#cancelPhase = this.#scheduler.after(this.#timing.startCountdownMs, () => this.#startRound(starter));
  }

  #startRound(starterSeat: number): void {
    const table = this.#requireTable();
    this.#setPhase('ROLLING');
    this.state.roundNo += 1;
    this.state.phaseEndsAt = 0;
    this.#currentBid = null;
    this.#lastBidderSeat = -1;
    this.#lastReveal = null;
    this.#roundStarterSeat = starterSeat;
    this.state.bids.clear();
    this.state.totalDice = totalDice(table);
    // S-03: 생존자 주사위를 동시에 굴리고 각자에게만 보낸다 (S-01)
    for (const p of this.#seated()) {
      const count = findPlayer(table, p.seat)?.diceCount ?? 0;
      p.dice = Array.from({ length: count }, () => (this.#rng.int(6) + 1) as DieFace);
    }
    for (const p of this.#seated()) {
      if (p.dice.length > 0) this.#sendTo(p.id, 'your_dice', { dice: [...p.dice] });
    }
    this.#setPhase('BIDDING');
    this.#startTurn(starterSeat);
  }

  #startTurn(seat: number): void {
    this.#clearTurnTimers();
    const m = this.#seatMember(seat);
    const now = this.#scheduler.now();
    const duration = this.#options.turnSeconds * this.#timing.msPerTurnSecond;
    this.#turnSeat = seat;
    this.#turnId = this.#rng.id();
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
    this.#cancelTurn = this.#scheduler.after(duration, () => this.#onTimeout(turnId));
    if (m.controller !== 'human') this.#scheduleBot(turnId);
  }

  #scheduleBot(turnId: string): void {
    this.#cancelBot?.();
    const { botDelayMinMs: min, botDelayMaxMs: max } = this.#timing;
    const turnMs = this.#options.turnSeconds * this.#timing.msPerTurnSecond;
    const delay = Math.min(min + this.#rng.int(Math.max(1, max - min + 1)), Math.max(0, turnMs - 1));
    this.#cancelBot = this.#scheduler.after(delay, () => {
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
    });
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
    this.#clearTurnTimers();
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
      createdAt: new Date(this.#scheduler.now()),
    });
    this.#broadcast('bid_made', { playerId: m.id, quantity: bid.quantity, face: bid.face, isAuto });
    this.#startTurn(nextTurnSeat(m.seat, aliveSeats(this.#requireTable())));
  }

  #applyLiar(caller: Member): void {
    this.#clearTurnTimers();
    const bid = this.#currentBid;
    if (bid === null) throw new Error('liar without a bid'); // canCallLiar가 먼저 막는다
    const bidder = this.#seatMember(this.#lastBidderSeat);
    this.#broadcast('liar_called', { caller: caller.id, target: bidder.id });
    this.#setPhase('REVEAL');
    this.state.currentTurn = '';
    this.state.turnId = '';
    this.state.deadline = 0;
    this.#turnId = '';
    this.#turnSeat = -1;

    const alive = this.#seated().filter((p) => p.dice.length > 0);
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
    this.state.phaseEndsAt = this.#scheduler.now() + this.#timing.revealMs;
    this.#cancelPhase = this.#scheduler.after(this.#timing.revealMs, () => this.#resolve(result));
  }

  #resolve(result: RoundResult): void {
    this.#setPhase('RESOLVE');
    this.state.phaseEndsAt = 0;
    const table = applyLoss(this.#requireTable(), result.loserSeat);
    this.#table = table;
    const loser = this.#seatMember(result.loserSeat);
    const after = findPlayer(table, loser.seat);
    if (!after) throw new Error(`seat ${loser.seat} missing from table`);
    loser.view.diceCount = after.diceCount;
    this.#broadcast('dice_lost', { playerId: loser.id, diceCount: after.diceCount });
    for (const p of this.#seated()) p.dice = [];
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
    this.#setPhase('GAME_OVER');
    this.#clearTurnTimers();
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
    this.#updateListing();
    this.#io.onRecord({
      gameId: this.#gameId,
      roomCode: this.state.roomCode,
      options: this.#options,
      startedAt: this.#startedAt,
      endedAt: new Date(this.#scheduler.now()),
      endReason: 'completed',
      players: entries.map(({ member, rank }) => ({
        guestId: member.guestId,
        nickname: member.nickname,
        seat: member.seat,
        isBot: member.originallyBot,
        replaced: this.#replacedIds.has(member.id),
        finalRank: rank,
      })),
      rounds: this.#roundLog,
      bids: this.#bidLog,
    });
  }

  #resetToWaiting(): void {
    for (const m of [...this.#members.values()]) {
      const replacedHuman = m.controller === 'bot' && !m.originallyBot;
      if (replacedHuman || (!m.originallyBot && !m.present)) this.#removeMember(m);
    }
    this.#table = null;
    this.#bySeat.clear();
    this.#currentBid = null;
    this.#lastReveal = null;
    this.state.bids.clear();
    this.state.roundNo = 0;
    this.state.totalDice = 0;
    this.#setPhase('WAITING');
    const ordered = [...this.#members.values()].sort((a, b) => a.joinOrder - b.joinOrder);
    // 관전자는 자리가 남으면 입장 순서대로 참가자가 된다
    let seated = this.#seated().length;
    for (const m of ordered) {
      if (m.spectator && seated < this.#options.maxPlayers) {
        m.spectator = false;
        seated += 1;
      }
      if (m.controller === 'autopilot') m.controller = 'human';
      m.ready = m.originallyBot || m.id === this.state.hostId;
      m.consecutiveTimeouts = 0;
      m.dice = [];
      m.seat = -1;
      Object.assign(m.view, {
        seat: -1,
        ready: m.ready,
        autopilot: false,
        spectator: m.spectator,
        diceCount: 0,
        eliminated: false,
        rank: 0,
      });
    }
    if (!this.state.hostId) {
      const next = this.#earliestHuman();
      if (next) this.#setHost(next);
    }
    this.#updateListing();
  }

  #checkAbandoned(): void {
    const humans = [...this.#members.values()].filter((m) => m.present && m.controller !== 'bot');
    const seatedHumans = humans.filter((m) => !m.spectator);
    // E-10: 게임 중 사람이 모두 나가면 방 종료, 전적 미기록
    if (humans.length === 0 || (IN_GAME.has(this.phase) && seatedHumans.length === 0)) {
      this.#abandon();
      return;
    }
    // S-10 미결정: 기본은 계속. 'end'로 설정하면 사람 1명 + 봇만 남았을 때 종료한다
    if (this.#alonePolicy === 'end' && IN_GAME.has(this.phase) && seatedHumans.length === 1) {
      const seated = this.#seated();
      if (seated.every((m) => m.controller === 'bot' || m === seatedHumans[0])) this.#abandon();
    }
  }

  #abandon(): void {
    this.dispose();
    this.#io.onAbandoned();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#clearTurnTimers();
    this.#cancelPhase?.();
    this.#cancelPhase = null;
  }

  // ───────────────────────── 보조 ─────────────────────────

  #seated(): Member[] {
    return [...this.#members.values()].filter((m) => !m.spectator);
  }

  #spectators(): Member[] {
    return [...this.#members.values()].filter((m) => m.spectator);
  }

  #earliestHuman(): Member | undefined {
    return [...this.#members.values()]
      .filter((m) => m.present && m.controller !== 'bot')
      .sort((a, b) => Number(a.spectator) - Number(b.spectator) || a.joinOrder - b.joinOrder)[0];
  }

  #setHost(m: Member): void {
    this.state.hostId = m.id;
    m.view.isHost = true;
    m.ready = true;
    m.view.ready = true;
  }

  #publicId(prefix: string): string {
    const raw = this.#rng.id().replace(/-/g, '');
    let id = `${prefix}${raw.slice(0, 12)}`;
    while (this.#members.has(id)) id = `${prefix}${this.#rng.id().replace(/-/g, '').slice(0, 12)}`;
    return id;
  }

  #addMember(input: { guestId: string | null; nickname: string; bot: boolean; spectator: boolean }): Member {
    const id = this.#publicId(input.bot ? 'b_' : 'p_');
    const joinOrder = (this.#joinCounter += 1);
    const view = new PlayerState({
      id,
      nickname: input.nickname,
      isBot: input.bot,
      ready: input.bot,
      spectator: input.spectator,
      connected: true,
    });
    const member: Member = {
      id,
      guestId: input.guestId,
      nickname: input.nickname,
      joinOrder,
      originallyBot: input.bot,
      controller: input.bot ? 'bot' : 'human',
      present: !input.bot,
      spectator: input.spectator,
      ready: input.bot,
      consecutiveTimeouts: 0,
      seat: -1,
      dice: [],
      view,
    };
    this.#members.set(id, member);
    if (input.guestId) this.#byGuest.set(input.guestId, id);
    this.state.players.set(id, view);
    return member;
  }

  #addBotMember(): Member {
    const used = new Set([...this.#members.values()].map((m) => m.nickname));
    let name: string;
    do {
      this.#botCounter += 1;
      name = `봇 ${this.#botCounter}`;
    } while (used.has(name));
    return this.#addMember({ guestId: null, nickname: name, bot: true, spectator: false });
  }

  #removeMember(m: Member): void {
    this.#members.delete(m.id);
    if (m.guestId && this.#byGuest.get(m.guestId) === m.id) this.#byGuest.delete(m.guestId);
    this.state.players.delete(m.id);
  }

  #syncOptions(): void {
    Object.assign(this.state.options, this.#options);
  }

  #updateListing(): void {
    const listed =
      !this.#options.isPrivate &&
      this.phase === 'WAITING' &&
      this.#seated().length < this.#options.maxPlayers;
    if (listed !== this.#listed) {
      this.#listed = listed;
      this.#io.onListingChange(listed);
    }
  }

  #setPhase(phase: GamePhase): void {
    this.state.phase = phase;
  }

  #seatMember(seat: number): Member {
    const m = this.#bySeat.get(seat);
    if (!m) throw new Error(`no member at seat ${seat}`);
    return m;
  }

  #requireTable(): TableState {
    if (!this.#table) throw new Error('table not initialised');
    return this.#table;
  }

  #clearTurnTimers(): void {
    this.#cancelTurn?.();
    this.#cancelBot?.();
    this.#cancelTurn = null;
    this.#cancelBot = null;
  }

  /** 명세 6장: 모든 서버 메시지의 순서 정보. seq는 방 단위로 증가한다 */
  envelope(): Envelope {
    return { roomId: this.state.roomCode, roundNo: this.state.roundNo, seq: (this.#seq += 1) };
  }

  #broadcast<T extends ServerMessageType>(type: T, payload: ServerMessages[T]): void {
    this.#io.broadcast(type, { ...payload, ...this.envelope() });
  }

  #sendTo<T extends ServerMessageType>(playerId: string, type: T, payload: ServerMessages[T]): void {
    this.#io.sendTo(playerId, type, { ...payload, ...this.envelope() });
  }
}
