import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * 숫자야구 공유 상태 (docs/specs/bulls-and-cows.md 5장, 6장).
 * B-20: 비밀 숫자는 넣지 않는다. 정했는지(secretSet)만 둔다. 게임이 끝나면 revealed에 공개한다 (B-23)
 */
export const BullsPlayerState = schema(
  {
    id: t.string(),
    nickname: t.string(),
    isBot: t.boolean().default(false),
    isHost: t.boolean().default(false),
    ready: t.boolean().default(false),
    connected: t.boolean().default(true),
    spectator: t.boolean().default(false),
    /** 대기실 -1, 게임 중 0(선공) 또는 1(후공) */
    seat: t.int8().default(-1),
    secretSet: t.boolean().default(false),
    attempts: t.uint8().default(0),
    /** 게임이 끝난 뒤에만 채운다 */
    revealed: t.string().default(''),
    replaced: t.boolean().default(false),
    autopilot: t.boolean().default(false),
  },
  'BullsPlayerState',
);
export type BullsPlayerState = SchemaType<typeof BullsPlayerState>;

export const BullsGuessState = schema(
  {
    playerId: t.string(),
    /** 시간 초과로 넘긴 턴이면 '' */
    guess: t.string().default(''),
    strikes: t.uint8().default(0),
    balls: t.uint8().default(0),
    skipped: t.boolean().default(false),
    isAuto: t.boolean().default(false),
  },
  'BullsGuessState',
);
export type BullsGuessState = SchemaType<typeof BullsGuessState>;

export const BullsOptionsState = schema(
  {
    digits: t.uint8().default(3),
    maxAttempts: t.uint8().default(10),
    turnSeconds: t.uint8().default(30),
    fillWithBots: t.boolean().default(true),
    isPrivate: t.boolean().default(true),
  },
  'BullsOptionsState',
);
export type BullsOptionsState = SchemaType<typeof BullsOptionsState>;

export const BullsState = schema(
  {
    phase: t.string().default('WAITING'),
    roomCode: t.string().default(''),
    hostId: t.string().default(''),
    options: t.ref(BullsOptionsState).default(() => new BullsOptionsState()),
    players: t.map(BullsPlayerState),
    history: t.array(BullsGuessState),
    currentTurn: t.string().default(''),
    turnId: t.string().default(''),
    deadline: t.float64().default(0),
    /** STARTING 카운트다운, SECRET 마감 시각 */
    phaseEndsAt: t.float64().default(0),
    /** B-07 */
    lastChance: t.boolean().default(false),
    /** '' | solved | draw */
    result: t.string().default(''),
    winnerId: t.string().default(''),
  },
  'BullsState',
);
export type BullsState = SchemaType<typeof BullsState>;
