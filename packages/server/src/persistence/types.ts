import type { BidFace, DieFace, RoomOptions } from '@wmg/rules';

/** 명세 10장: 판이 끝날 때 한 번에 저장하는 기록 (CLAUDE.md 원칙 8) */
export interface GameRecord {
  readonly gameId: string;
  readonly roomCode: string;
  readonly options: RoomOptions;
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly endReason: 'completed';
  readonly players: readonly GamePlayerRecord[];
  readonly rounds: readonly RoundRecord[];
  readonly bids: readonly BidRecord[];
}

export interface GamePlayerRecord {
  /** 사람이면 게스트 ID (players.id). 처음부터 봇이면 null */
  readonly guestId: string | null;
  readonly nickname: string;
  readonly seat: number;
  readonly isBot: boolean;
  readonly finalRank: number;
}

export interface RoundRecord {
  readonly roundNo: number;
  readonly starterSeat: number;
  /** 공개 후의 값만 저장한다 */
  readonly dice: ReadonlyArray<{ readonly seat: number; readonly dice: readonly DieFace[] }>;
  readonly result: {
    readonly bid: { readonly quantity: number; readonly face: BidFace };
    readonly actual: number;
    readonly bidSucceeded: boolean;
    readonly bidderSeat: number;
    readonly callerSeat: number;
    readonly loserSeat: number;
  };
}

export interface BidRecord {
  readonly roundNo: number;
  readonly seq: number;
  readonly seat: number;
  readonly quantity: number;
  readonly face: BidFace;
  readonly isAuto: boolean;
  readonly createdAt: Date;
}

/**
 * 저장소 인터페이스. 로그인 방식이 정해지면(명세 12장) 플레이어 식별 부분만 바꾼다.
 * save는 실패해도 게임을 막지 않아야 한다 (M3).
 */
export interface GameRecorder {
  save(record: GameRecord): Promise<void>;
  close(): Promise<void>;
}

export const noopRecorder: GameRecorder = {
  save: async () => {},
  close: async () => {},
};

/** 테스트용 메모리 저장소 */
export class MemoryRecorder implements GameRecorder {
  readonly records: GameRecord[] = [];
  async save(record: GameRecord): Promise<void> {
    this.records.push(record);
  }
  async close(): Promise<void> {}
}
