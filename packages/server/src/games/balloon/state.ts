import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * 풍선 터뜨리기 공유 상태 (docs/specs/balloon.md 6장).
 * 터지는 횟수(threshold)는 판이 끝난 뒤에만 채운다 (BL-20). 그 전에는 0이다.
 */
export const BalloonPlayerState = schema(
  {
    id: t.string(),
    nickname: t.string(),
    isBot: t.boolean().default(false),
    isHost: t.boolean().default(false),
    ready: t.boolean().default(false),
    connected: t.boolean().default(true),
    spectator: t.boolean().default(false),
    /** -1 대기실, 0부터 게임 중 좌석 */
    seat: t.int8().default(-1),
    replaced: t.boolean().default(false),
    /** BL-12: 시간 초과가 2번 이어져 봇이 대신 하는 중 */
    autopilot: t.boolean().default(false),
  },
  'BalloonPlayerState',
);
export type BalloonPlayerState = SchemaType<typeof BalloonPlayerState>;

export const BalloonOptionsState = schema(
  {
    maxPlayers: t.uint8().default(6),
    turnSeconds: t.uint8().default(15),
    fillWithBots: t.boolean().default(true),
    isPrivate: t.boolean().default(true),
  },
  'BalloonOptionsState',
);
export type BalloonOptionsState = SchemaType<typeof BalloonOptionsState>;

/** 끝난 차례 하나 */
export const BalloonTurnState = schema(
  {
    playerId: t.string(),
    pumps: t.uint8(),
    isAuto: t.boolean().default(false),
    popped: t.boolean().default(false),
  },
  'BalloonTurnState',
);
export type BalloonTurnState = SchemaType<typeof BalloonTurnState>;

export const BalloonState = schema(
  {
    phase: t.string().default('WAITING'),
    roomCode: t.string().default(''),
    hostId: t.string().default(''),
    options: t.ref(BalloonOptionsState).default(() => new BalloonOptionsState()),
    players: t.map(BalloonPlayerState),
    /** 지금까지 분 횟수 */
    total: t.uint8().default(0),
    /** 이번 차례에 누른 횟수 */
    turnPumps: t.uint8().default(0),
    /** 공개된 터지는 범위의 최대 (인원 × 4 + 12). 시작할 때 채운다 */
    maxPops: t.uint8().default(0),
    history: t.array(BalloonTurnState),
    currentTurn: t.string().default(''),
    turnId: t.string().default(''),
    deadline: t.float64().default(0),
    phaseEndsAt: t.float64().default(0),
    loserId: t.string().default(''),
    /** 터지는 횟수. 끝난 뒤에만 채운다 (BL-20, BL-22) */
    threshold: t.uint8().default(0),
  },
  'BalloonState',
);
export type BalloonState = SchemaType<typeof BalloonState>;
