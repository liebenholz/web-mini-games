import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * Colyseus 공유 상태. 모든 클라이언트(관전자 포함)에게 그대로 동기화된다.
 * CLAUDE.md 원칙 4, S-01: 여기에는 공개 정보만 넣는다. 주사위 눈 필드를 추가하지 말 것.
 * playerId는 서버가 발급한 공개 ID이며 게스트 ID(비밀)와 다르다.
 */
export const PlayerState = schema(
  {
    id: t.string(),
    nickname: t.string(),
    /** 게임 중 좌석 번호. 대기실에서는 입장 순서 */
    seat: t.int8().default(-1),
    isBot: t.boolean().default(false),
    isHost: t.boolean().default(false),
    ready: t.boolean().default(false),
    connected: t.boolean().default(true),
    /** S-07: 2연속 타임아웃으로 봇이 대신 플레이 중 */
    autopilot: t.boolean().default(false),
    /** E-11: 게임 중 입장한 관전자 */
    spectator: t.boolean().default(false),
    diceCount: t.uint8().default(0),
    eliminated: t.boolean().default(false),
    /** 0이면 미확정 */
    rank: t.uint8().default(0),
  },
  'PlayerState',
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const BidState = schema(
  {
    playerId: t.string(),
    quantity: t.uint8(),
    face: t.uint8(),
    isAuto: t.boolean().default(false),
  },
  'BidState',
);
export type BidState = SchemaType<typeof BidState>;

export const OptionsState = schema(
  {
    maxPlayers: t.uint8().default(6),
    fillWithBots: t.boolean().default(true),
    turnSeconds: t.uint8().default(30),
    startingDice: t.uint8().default(5),
    isPrivate: t.boolean().default(true),
  },
  'OptionsState',
);
export type OptionsState = SchemaType<typeof OptionsState>;

export const LiarsDiceState = schema(
  {
    phase: t.string().default('WAITING'),
    roomCode: t.string().default(''),
    hostId: t.string().default(''),
    options: t.ref(OptionsState).default(() => new OptionsState()),
    players: t.map(PlayerState),
    roundNo: t.uint16().default(0),
    totalDice: t.uint8().default(0),
    /** 현재 차례 playerId */
    currentTurn: t.string().default(''),
    turnId: t.string().default(''),
    /** 턴 마감 시각 (서버 시간, epoch ms) S-05 */
    deadline: t.float64().default(0),
    /** STARTING 카운트다운, REVEAL 연출이 끝나는 시각 */
    phaseEndsAt: t.float64().default(0),
    /** 이번 라운드 선언 기록 */
    bids: t.array(BidState),
  },
  'LiarsDiceState',
);
export type LiarsDiceState = SchemaType<typeof LiarsDiceState>;
