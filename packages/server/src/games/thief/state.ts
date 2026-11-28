import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * 도둑잡기 공유 상태 (docs/specs/thief.md 5장).
 * 패의 카드 번호는 넣지 않는다 (원칙 4). 장수와 내려놓은 짝(숫자)만 공개한다.
 * finalHand는 판이 끝난 뒤에만 채운다 (TF-11).
 */
export const ThiefPlayerState = schema(
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
    handCount: t.uint8().default(0),
    /** 패를 다 내서 안전하다 (TF-08) */
    out: t.boolean().default(false),
    /** 빠진 순서 (1부터, 아직이면 0) */
    outOrder: t.uint8().default(0),
    /** 끝난 뒤 마지막 패 */
    finalHand: t.array('string'),
    replaced: t.boolean().default(false),
    /** TF-12: 시간 초과가 2번 이어져 봇이 대신 하는 중 */
    autopilot: t.boolean().default(false),
  },
  'ThiefPlayerState',
);
export type ThiefPlayerState = SchemaType<typeof ThiefPlayerState>;

export const ThiefOptionsState = schema(
  {
    maxPlayers: t.uint8().default(4),
    turnSeconds: t.uint8().default(15),
    fillWithBots: t.boolean().default(true),
    isPrivate: t.boolean().default(true),
  },
  'ThiefOptionsState',
);
export type ThiefOptionsState = SchemaType<typeof ThiefOptionsState>;

export const ThiefState = schema(
  {
    phase: t.string().default('WAITING'),
    roomCode: t.string().default(''),
    hostId: t.string().default(''),
    options: t.ref(ThiefOptionsState).default(() => new ThiefOptionsState()),
    players: t.map(ThiefPlayerState),
    /** 지금 뽑는 사람과 뽑힐 사람 */
    currentTurn: t.string().default(''),
    targetId: t.string().default(''),
    turnId: t.string().default(''),
    deadline: t.float64().default(0),
    phaseEndsAt: t.float64().default(0),
    /** 내려놓은 짝의 숫자 (공개) */
    pairs: t.array('string'),
    draws: t.uint16().default(0),
    loserId: t.string().default(''),
  },
  'ThiefState',
);
export type ThiefState = SchemaType<typeof ThiefState>;
