import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * 리버시 공유 상태 (docs/specs/reversi.md 4장). 숨길 정보가 없어서 판 전체를 그대로 동기화한다.
 * playerId는 서버가 발급한 공개 ID이며 게스트 ID(비밀)와 다르다.
 */
export const ReversiPlayerState = schema(
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
    /** RV-11: 사람이 나가서 봇이 이어서 두는 중 */
    replaced: t.boolean().default(false),
    /** RV-12: 시간 초과가 2번 이어져 봇이 대신 두는 중. 직접 두면 풀린다 */
    autopilot: t.boolean().default(false),
  },
  'ReversiPlayerState',
);
export type ReversiPlayerState = SchemaType<typeof ReversiPlayerState>;

export const ReversiOptionsState = schema(
  {
    blackPolicy: t.string().default('random'),
    turnSeconds: t.uint8().default(30),
    fillWithBots: t.boolean().default(true),
    isPrivate: t.boolean().default(true),
  },
  'ReversiOptionsState',
);
export type ReversiOptionsState = SchemaType<typeof ReversiOptionsState>;

export const ReversiState = schema(
  {
    phase: t.string().default('WAITING'),
    roomCode: t.string().default(''),
    hostId: t.string().default(''),
    options: t.ref(ReversiOptionsState).default(() => new ReversiOptionsState()),
    players: t.map(ReversiPlayerState),
    /** 64칸 (0 빈칸, 1 흑, 2 백). 인덱스 = y * 8 + x (y=0이 1행, 맨 위) */
    board: t.array('uint8'),
    moveCount: t.uint8().default(0),
    passCount: t.uint8().default(0),
    /** 마지막 수의 인덱스. 없으면 -1 */
    lastMove: t.int8().default(-1),
    currentTurn: t.string().default(''),
    turnId: t.string().default(''),
    /** 턴 마감 시각 (서버 시간, epoch ms) RV-10 */
    deadline: t.float64().default(0),
    /** STARTING 카운트다운이 끝나는 시각 */
    phaseEndsAt: t.float64().default(0),
    /** 결과: '' | count | draw */
    result: t.string().default(''),
    winnerId: t.string().default(''),
  },
  'ReversiState',
);
export type ReversiState = SchemaType<typeof ReversiState>;
