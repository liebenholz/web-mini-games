import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * 보물 찾기 공유 상태 (docs/specs/treasure.md 6장).
 * 보물 위치와 다른 사람의 선택은 REVEAL 전에는 넣지 않는다 (BH-20, BH-21). 확정했는지(locked)만 보인다.
 */
export const TreasurePlayerState = schema(
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
    /** 이번 선택 단계에서 선택을 확정했다 (칸은 보이지 않는다) */
    locked: t.boolean().default(false),
    /** 이번 선택 단계에 참가한다 (재대결에서 동점자만 true) */
    inRound: t.boolean().default(false),
    replaced: t.boolean().default(false),
    /** BH-12: 못 골라서 대신 고른 일이 2번 이어져 봇이 대신 하는 중 */
    autopilot: t.boolean().default(false),
  },
  'TreasurePlayerState',
);
export type TreasurePlayerState = SchemaType<typeof TreasurePlayerState>;

export const TreasureOptionsState = schema(
  {
    maxPlayers: t.uint8().default(6),
    pickSeconds: t.uint8().default(15),
    fillWithBots: t.boolean().default(true),
    isPrivate: t.boolean().default(true),
  },
  'TreasureOptionsState',
);
export type TreasureOptionsState = SchemaType<typeof TreasureOptionsState>;

/** REVEAL 때 공개하는 선택 하나 */
export const TreasurePickState = schema(
  {
    playerId: t.string(),
    x: t.uint8(),
    y: t.uint8(),
    distSq: t.uint8(),
    isAuto: t.boolean().default(false),
  },
  'TreasurePickState',
);
export type TreasurePickState = SchemaType<typeof TreasurePickState>;

/** 공개된 한 단계 (보물과 모든 선택). REVEAL 전에는 비어 있다 */
export const TreasureRevealState = schema(
  {
    treasureX: t.uint8().default(0),
    treasureY: t.uint8().default(0),
    picks: t.array(TreasurePickState),
    /** 가장 먼 사람들의 playerId를 쉼표로 이은 값 */
    far: t.string().default(''),
    tie: t.boolean().default(false),
  },
  'TreasureRevealState',
);
export type TreasureRevealState = SchemaType<typeof TreasureRevealState>;

export const TreasureState = schema(
  {
    phase: t.string().default('WAITING'),
    roomCode: t.string().default(''),
    hostId: t.string().default(''),
    options: t.ref(TreasureOptionsState).default(() => new TreasureOptionsState()),
    players: t.map(TreasurePlayerState),
    roundId: t.string().default(''),
    /** 재대결 횟수 (처음은 0) */
    replay: t.uint8().default(0),
    deadline: t.float64().default(0),
    phaseEndsAt: t.float64().default(0),
    reveal: t.ref(TreasureRevealState).default(() => new TreasureRevealState()),
    /** REVEAL 이후 값이 있다 (hasReveal) */
    hasReveal: t.boolean().default(false),
    loserId: t.string().default(''),
    tieBreak: t.boolean().default(false),
  },
  'TreasureState',
);
export type TreasureState = SchemaType<typeof TreasureState>;
