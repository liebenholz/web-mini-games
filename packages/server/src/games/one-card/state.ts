import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * 원카드 공유 상태 (docs/specs/one-card.md 8장, 9장).
 * C-40: 패는 절대 넣지 않는다. 각자 패 장수만 둔다. 덱 순서도 넣지 않는다 (C-41)
 */
export const OneCardPlayerState = schema(
  {
    id: t.string(),
    nickname: t.string(),
    isBot: t.boolean().default(false),
    isHost: t.boolean().default(false),
    ready: t.boolean().default(false),
    connected: t.boolean().default(true),
    spectator: t.boolean().default(false),
    /** 대기실에서는 -1 */
    seat: t.int8().default(-1),
    handCount: t.uint8().default(0),
    /** '' 대기실, playing | finished | bankrupt */
    status: t.string().default(''),
    /** 확정된 순위. 0이면 아직 없음 */
    rank: t.uint8().default(0),
    /** C-55: 사람이 나가서 봇이 이어받음 */
    replaced: t.boolean().default(false),
    /** C-52: 시간 초과 2번으로 봇이 대신 두는 중 */
    autopilot: t.boolean().default(false),
  },
  'OneCardPlayerState',
);
export type OneCardPlayerState = SchemaType<typeof OneCardPlayerState>;

export const OneCardOptionsState = schema(
  {
    maxPlayers: t.uint8().default(4),
    turnSeconds: t.uint8().default(30),
    fillWithBots: t.boolean().default(true),
    isPrivate: t.boolean().default(true),
  },
  'OneCardOptionsState',
);
export type OneCardOptionsState = SchemaType<typeof OneCardOptionsState>;

export const OneCardState = schema(
  {
    phase: t.string().default('WAITING'),
    roomCode: t.string().default(''),
    hostId: t.string().default(''),
    options: t.ref(OneCardOptionsState).default(() => new OneCardOptionsState()),
    players: t.map(OneCardPlayerState),
    /** 버린 더미 맨 위(펼친 카드). 대기실에서는 '' */
    topCard: t.string().default(''),
    /** C-12: 7을 내고 고른 모양 */
    chosenSuit: t.string().default(''),
    /** C-21: 누적 공격 장수 */
    attack: t.uint8().default(0),
    /** 1 시계 방향, -1 반대 */
    direction: t.int8().default(1),
    deckCount: t.uint8().default(0),
    currentTurn: t.string().default(''),
    turnId: t.string().default(''),
    /** 턴 마감 시각 (서버 시간, epoch ms). 원카드 창 동안에는 0 (C-32) */
    deadline: t.float64().default(0),
    /** STARTING 카운트다운이 끝나는 시각 */
    phaseEndsAt: t.float64().default(0),
    /** C-30: 열린 원카드 창. 없으면 '' */
    windowId: t.string().default(''),
    windowTarget: t.string().default(''),
    windowClosesAt: t.float64().default(0),
  },
  'OneCardState',
);
export type OneCardState = SchemaType<typeof OneCardState>;
