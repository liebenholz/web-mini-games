/** 주사위 한 개의 눈 (1~6). 1은 와일드 (R-09). */
export type DieFace = 1 | 2 | 3 | 4 | 5 | 6;

/** 선언할 수 있는 눈 (2~6). v1에서는 1 선언 금지 (R-05). */
export type BidFace = 2 | 3 | 4 | 5 | 6;

export const DIE_FACES: readonly DieFace[] = [1, 2, 3, 4, 5, 6];
export const BID_FACES: readonly BidFace[] = [2, 3, 4, 5, 6];

/** "테이블 전체에 face가 quantity개 이상 있다" */
export interface Bid {
  readonly quantity: number;
  readonly face: BidFace;
}

export interface RuleOptions {
  /** R-09: 공개 시 1을 선언된 눈으로 함께 센다 */
  readonly onesWild: boolean;
}

export const DEFAULT_RULE_OPTIONS: RuleOptions = Object.freeze({ onesWild: true });

/** 한 좌석의 주사위 눈. 공개(REVEAL) 전에는 서버 안에서만 존재한다 (S-01). */
export interface PlayerDice {
  readonly seat: number;
  readonly dice: readonly DieFace[];
}

/** 공개 정보만 담은 좌석 상태 */
export interface TablePlayer {
  readonly seat: number;
  /** 남은 주사위 수 = 남은 목숨 (R-01) */
  readonly diceCount: number;
  /** 몇 번째로 탈락했는지 (1부터). 생존 중이면 null (R-12, R-13) */
  readonly eliminationOrder: number | null;
}

/** 라운드 사이에 유지되는 테이블 상태 (공개 정보) */
export interface TableState {
  readonly players: readonly TablePlayer[];
}

export interface RoundResult {
  readonly bid: Bid;
  /** 공개 후 선언 눈으로 센 실제 개수 (1 포함) */
  readonly actual: number;
  /** 실제 개수 ≥ 선언 개수 */
  readonly bidSucceeded: boolean;
  readonly bidderSeat: number;
  readonly callerSeat: number;
  /** 주사위 1개를 잃는 좌석 (R-10) */
  readonly loserSeat: number;
}

export type InvalidBidReason = 'NOT_INTEGER' | 'FACE_OUT_OF_RANGE' | 'QUANTITY_OUT_OF_RANGE' | 'NOT_HIGHER';

export type BidCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'INVALID_BID'; readonly reason: InvalidBidReason };

export type LiarCheck = { readonly ok: true } | { readonly ok: false; readonly code: 'NO_BID_TO_CALL' };
