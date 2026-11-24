/** 게임마다 다른 연결과 화면을 메인 라우터에서 같은 모양으로 다루기 위한 계약 (ADR 0002) */
export interface GameSession {
  /** 초대 주소에 쓰는 방 코드 */
  readonly roomCode: string;
  onClosed(fn: (reason: string | null) => void): () => void;
  leave(): Promise<void>;
}

export interface GameFlow<S extends GameSession = GameSession> {
  create(nickname: string): Promise<S>;
  join(code: string, nickname: string): Promise<S>;
  quickMatch(nickname: string): Promise<S>;
  /** 대기실과 대국 화면을 상태에 맞게 붙인다. 돌려준 함수로 화면을 정리한다 */
  mount(session: S, ctx: { readonly exit: () => void }): () => void;
}

/**
 * 게임별 세션 타입을 가진 흐름을 라우터가 쓰는 공통 모양으로 바꾼다.
 * 라우터는 그 흐름이 만든 세션만 다시 넘기므로 안전하다
 */
export function asFlow<S extends GameSession>(flow: GameFlow<S>): GameFlow {
  return flow as unknown as GameFlow;
}
