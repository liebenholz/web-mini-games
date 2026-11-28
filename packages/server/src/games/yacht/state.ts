import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * 요트 주사위 공유 상태 (docs/specs/yacht.md 6장). 주사위와 점수표는 모두 공개 정보다.
 */
export const YachtPlayerState = schema(
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
    /** 12칸. 아직 안 쓴 칸은 -1 */
    scores: t.array('int16'),
    upperSum: t.uint8().default(0),
    bonus: t.uint8().default(0),
    total: t.uint16().default(0),
    replaced: t.boolean().default(false),
    /** YT-12: 시간 초과가 2번 이어져 봇이 대신 하는 중 */
    autopilot: t.boolean().default(false),
  },
  'YachtPlayerState',
);
export type YachtPlayerState = SchemaType<typeof YachtPlayerState>;

export const YachtOptionsState = schema(
  {
    maxPlayers: t.uint8().default(2),
    turnSeconds: t.uint8().default(45),
    fillWithBots: t.boolean().default(true),
    isPrivate: t.boolean().default(true),
  },
  'YachtOptionsState',
);
export type YachtOptionsState = SchemaType<typeof YachtOptionsState>;

export const YachtState = schema(
  {
    phase: t.string().default('WAITING'),
    roomCode: t.string().default(''),
    hostId: t.string().default(''),
    options: t.ref(YachtOptionsState).default(() => new YachtOptionsState()),
    players: t.map(YachtPlayerState),
    currentTurn: t.string().default(''),
    turnId: t.string().default(''),
    deadline: t.float64().default(0),
    phaseEndsAt: t.float64().default(0),
    /** 지금 주사위 (굴리기 전에는 비어 있다) */
    dice: t.array('uint8'),
    /** 마지막 굴림에서 남긴 주사위 */
    held: t.array('uint8'),
    rollNo: t.uint8().default(0),
    /** 끝난 차례 수 */
    turnsDone: t.uint8().default(0),
  },
  'YachtState',
);
export type YachtState = SchemaType<typeof YachtState>;
