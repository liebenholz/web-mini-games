/**
 * 부하 테스트: 방 하나를 진짜 WebSocket 접속으로 한 판 끝까지 진행한다.
 * 방장이 방을 만들고, 나머지가 방 코드로 들어와 준비하고, 빈자리는 서버 봇이 채운다.
 * 사람은 생각하는 시간(thinkMs)을 두고 자기 차례에 룰 봇 함수로 둔다.
 */
import { randomBytes } from 'node:crypto';
import { Client, type Room } from '@colyseus/sdk';
import type { DieFace, gomoku, oneCard } from '@wmg/rules';
import {
  decideBulls,
  decideGomoku,
  decideLiars,
  decideOneCard,
  isMyTurn,
  type Action,
  type BullsView,
  type GomokuView,
  type LiarsView,
  type OneCardView,
} from './agents.js';

export const GAME_TYPES = ['liars_dice', 'gomoku', 'one_card', 'bulls_and_cows'] as const;
export type GameType = (typeof GAME_TYPES)[number];

/** 게임마다 사람 수와 방 옵션. 남는 자리는 서버 봇이 채운다 */
export const ROOM_SHAPES: Record<GameType, { humans: number; options: Record<string, unknown> }> = {
  liars_dice: { humans: 3, options: { maxPlayers: 4, startingDice: 5, fillWithBots: true } },
  gomoku: { humans: 2, options: { fillWithBots: true } },
  one_card: { humans: 3, options: { maxPlayers: 4, fillWithBots: true } },
  bulls_and_cows: { humans: 2, options: { fillWithBots: true } },
};

/** 부하용 게스트 ID 접두어. 끝난 뒤 이 접두어로 DB 기록을 지운다 */
export const LOADTEST_PREFIX = 'loadtest-';

export interface RoomStats {
  joinMs: number[];
  errors: Map<string, number>;
  disconnects: number;
  actions: number;
}

export function newStats(): RoomStats {
  return { joinMs: [], errors: new Map(), disconnects: 0, actions: 0 };
}

export interface PlayOptions {
  readonly endpoint: string;
  readonly game: GameType;
  readonly thinkMs: readonly [number, number];
  readonly stats: RoomStats;
  readonly signal: AbortSignal;
  /** 한 판이 이 시간보다 길면 포기하고 나간다 */
  readonly maxGameMs: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const between = ([lo, hi]: readonly [number, number]) => lo + Math.random() * (hi - lo);
const pick = (n: number) => Math.floor(Math.random() * n);

/** 한 사람. 상태가 바뀔 때마다 자기 차례인지 보고 한 번만 행동한다 */
class Player {
  readonly room: Room;
  myId = '';
  #acted = '';
  #busy = false;
  #dice: DieFace[] = [];
  #hand: oneCard.Card[] = [];
  #drawn: oneCard.Card | null = null;
  over = false;

  constructor(
    room: Room,
    readonly game: GameType,
    readonly opts: PlayOptions,
  ) {
    this.room = room;
    room.onMessage('*', (type, payload) => this.#onMessage(String(type), payload as Record<string, unknown>));
    room.onStateChange(() => this.#maybeAct());
    room.onLeave((code) => {
      if (!this.over && code !== 1000 && code !== 4000) opts.stats.disconnects += 1;
      this.over = true;
    });
  }

  get state(): Record<string, unknown> {
    return this.room.state as unknown as Record<string, unknown>;
  }

  #onMessage(type: string, p: Record<string, unknown>): void {
    switch (type) {
      case 'welcome':
        this.myId = String(p.playerId);
        break;
      case 'your_dice':
        this.#dice = p.dice as DieFace[];
        break;
      case 'your_hand':
        this.#hand = p.cards as oneCard.Card[];
        this.#drawn = (p.drawn as oneCard.Card | null) ?? null;
        break;
      case 'one_card_window':
        if (p.playerId === this.myId) this.send('call_one_card', { windowId: p.windowId });
        break;
      case 'game_over':
        this.over = true;
        break;
      case 'error': {
        const code = String(p.code);
        this.opts.stats.errors.set(code, (this.opts.stats.errors.get(code) ?? 0) + 1);
        // 거절당한 턴은 다시 고를 수 있게 한다
        this.#acted = '';
        break;
      }
    }
    this.#maybeAct();
  }

  send(type: string, payload: Record<string, unknown>): void {
    if (this.over) return;
    try {
      this.room.send(type, payload);
    } catch {
      // 이미 끊긴 방
    }
  }

  #maybeAct(): void {
    if (this.over || this.#busy || this.myId === '') return;
    const s = this.state;
    if (this.game === 'bulls_and_cows' && s.phase === 'SECRET') {
      const me = (s.players as Map<string, { secretSet: boolean }> | undefined)?.get(this.myId);
      if (me && !me.secretSet && this.#acted !== 'secret') {
        this.#acted = 'secret';
        this.send('random_secret', {});
      }
      return;
    }
    const view = s as unknown as { phase: string; currentTurn: string; turnId: string };
    if (!isMyTurn(view, this.myId)) return;
    const key = `${view.turnId}:${this.#drawn ?? ''}`;
    if (key === this.#acted) return;
    this.#acted = key;
    this.#busy = true;
    void sleep(between(this.opts.thinkMs)).then(() => {
      this.#busy = false;
      // 생각하는 동안 차례가 넘어갔으면(원카드에서 뽑은 뒤 바로 넘어가는 경우 등) 보내지 않는다
      const now = this.state as unknown as { turnId: string; currentTurn: string };
      if (this.over || now.turnId !== view.turnId || now.currentTurn !== this.myId) return;
      const action = this.#decide();
      if (action) {
        this.opts.stats.actions += 1;
        this.send(action.type, action.payload);
      }
    });
  }

  #decide(): Action | null {
    const s = this.state;
    switch (this.game) {
      case 'liars_dice':
        return decideLiars(s as unknown as LiarsView, this.#dice);
      case 'gomoku': {
        const me = (s.players as Map<string, { color: string }>).get(this.myId);
        return decideGomoku(s as unknown as GomokuView, (me?.color ?? 'black') as gomoku.GomokuColor);
      }
      case 'one_card':
        return decideOneCard(s as unknown as OneCardView, this.#hand, this.#drawn);
      case 'bulls_and_cows': {
        const me = (s.players as Map<string, { seat: number }>).get(this.myId);
        return decideBulls(s as unknown as BullsView, this.myId, me?.seat === 1 ? 1 : 0, pick);
      }
    }
  }
}

function guestOptions(n: number): { guestId: string; nickname: string } {
  return { guestId: `${LOADTEST_PREFIX}${randomBytes(8).toString('hex')}`, nickname: `부하${n}` };
}

async function timed<T>(stats: RoomStats, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  const out = await fn();
  stats.joinMs.push(performance.now() - t0);
  return out;
}

/** 방 하나에서 한 판을 끝까지 하고 모두 나간다. 오류는 호출한 쪽에서 센다 */
export async function playOneGame(opts: PlayOptions): Promise<void> {
  const shape = ROOM_SHAPES[opts.game];
  const client = new Client(opts.endpoint);
  const players: Player[] = [];
  try {
    const hostRoom = await timed(opts.stats, () =>
      client.create(opts.game, { ...guestOptions(1), options: shape.options }),
    );
    const host = new Player(hostRoom, opts.game, opts);
    players.push(host);
    for (let i = 2; i <= shape.humans; i += 1) {
      const room = await timed(opts.stats, () => client.joinById(hostRoom.roomId, guestOptions(i)));
      const p = new Player(room, opts.game, opts);
      players.push(p);
      await sleep(200);
      p.send('set_ready', { ready: true });
    }
    // 준비가 반영될 때까지 시작을 몇 번 시도한다 (NOT_ALL_READY는 무시)
    for (let i = 0; i < 20 && host.state.phase === 'WAITING' && !opts.signal.aborted; i += 1) {
      host.send('start_game', {});
      await sleep(500);
    }
    const deadline = Date.now() + opts.maxGameMs;
    while (!opts.signal.aborted && Date.now() < deadline && !players.every((p) => p.over)) {
      await sleep(500);
    }
  } finally {
    // 동의한 퇴장. 진행 중이면 서버 봇이 이어받고, 사람이 모두 나가면 방이 기록 없이 끝난다 (E-10)
    await Promise.allSettled(
      players.map((p) => {
        p.over = true;
        return p.room.leave(true);
      }),
    );
  }
}
