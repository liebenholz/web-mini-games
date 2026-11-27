import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * 업다운 숫자폭탄 공유 상태 (docs/specs/updown-bomb.md 6장).
 * 폭탄 숫자(bomb)는 판이 끝난 뒤에만 채운다 (UD-20). 그 전에는 0이다.
 */
export const UpdownPlayerState = schema(
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
    /** 공통: 사람이 나가서 봇이 이어서 하는 중 */
    replaced: t.boolean().default(false),
    /** UD-12: 시간 초과가 2번 이어져 봇이 대신 하는 중 */
    autopilot: t.boolean().default(false),
  },
  'UpdownPlayerState',
);
export type UpdownPlayerState = SchemaType<typeof UpdownPlayerState>;

export const UpdownOptionsState = schema(
  {
    rangeMax: t.uint8().default(100),
    maxPlayers: t.uint8().default(6),
    turnSeconds: t.uint8().default(15),
    fillWithBots: t.boolean().default(true),
    isPrivate: t.boolean().default(true),
  },
  'UpdownOptionsState',
);
export type UpdownOptionsState = SchemaType<typeof UpdownOptionsState>;

export const UpdownCallState = schema(
  {
    playerId: t.string(),
    value: t.uint8(),
    /** up | down | bomb */
    result: t.string(),
    isAuto: t.boolean().default(false),
  },
  'UpdownCallState',
);
export type UpdownCallState = SchemaType<typeof UpdownCallState>;

export const UpdownState = schema(
  {
    phase: t.string().default('WAITING'),
    roomCode: t.string().default(''),
    hostId: t.string().default(''),
    options: t.ref(UpdownOptionsState).default(() => new UpdownOptionsState()),
    players: t.map(UpdownPlayerState),
    /** 지금 범위 (양 끝 포함) */
    low: t.uint8().default(1),
    high: t.uint8().default(100),
    history: t.array(UpdownCallState),
    currentTurn: t.string().default(''),
    turnId: t.string().default(''),
    deadline: t.float64().default(0),
    phaseEndsAt: t.float64().default(0),
    /** 당첨자. 끝나기 전에는 '' */
    loserId: t.string().default(''),
    /** 폭탄 숫자. 끝난 뒤에만 채운다 (UD-20, UD-22) */
    bomb: t.uint8().default(0),
    forced: t.boolean().default(false),
  },
  'UpdownState',
);
export type UpdownState = SchemaType<typeof UpdownState>;
