import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * 오목 공유 상태 (docs/specs/gomoku.md 6장). 오목에는 숨길 정보가 없어서 판 전체를 그대로 동기화한다.
 * playerId는 서버가 발급한 공개 ID이며 게스트 ID(비밀)와 다르다.
 */
export const GomokuPlayerState = schema(
  {
    id: t.string(),
    nickname: t.string(),
    isBot: t.boolean().default(false),
    isHost: t.boolean().default(false),
    ready: t.boolean().default(false),
    connected: t.boolean().default(true),
    spectator: t.boolean().default(false),
    /** '' 대기실, 'black' | 'white' 대국 중 */
    color: t.string().default(''),
    /** G-22: 사람이 나가서 봇이 이어서 두는 중 */
    replaced: t.boolean().default(false),
  },
  'GomokuPlayerState',
);
export type GomokuPlayerState = SchemaType<typeof GomokuPlayerState>;

export const GomokuOptionsState = schema(
  {
    blackPolicy: t.string().default('random'),
    forbidDoubleThree: t.boolean().default(true),
    forbidDoubleFour: t.boolean().default(true),
    forbidOverline: t.boolean().default(true),
    turnSeconds: t.uint8().default(30),
    fillWithBots: t.boolean().default(true),
    isPrivate: t.boolean().default(true),
  },
  'GomokuOptionsState',
);
export type GomokuOptionsState = SchemaType<typeof GomokuOptionsState>;

export const GomokuState = schema(
  {
    phase: t.string().default('WAITING'),
    roomCode: t.string().default(''),
    hostId: t.string().default(''),
    options: t.ref(GomokuOptionsState).default(() => new GomokuOptionsState()),
    players: t.map(GomokuPlayerState),
    /** 225칸 (0 빈칸, 1 흑, 2 백). 인덱스 = y * 15 + x */
    board: t.array('uint8'),
    moveCount: t.uint16().default(0),
    /** 마지막 수의 인덱스. 없으면 -1 */
    lastMove: t.int16().default(-1),
    currentTurn: t.string().default(''),
    turnId: t.string().default(''),
    /** 턴 마감 시각 (서버 시간, epoch ms) G-20 */
    deadline: t.float64().default(0),
    /** STARTING 카운트다운이 끝나는 시각 */
    phaseEndsAt: t.float64().default(0),
    /** 결과: '' | five | timeout | draw */
    result: t.string().default(''),
    winnerId: t.string().default(''),
    /** 승리한 줄의 인덱스들 */
    winLine: t.array('int16'),
  },
  'GomokuState',
);
export type GomokuState = SchemaType<typeof GomokuState>;
