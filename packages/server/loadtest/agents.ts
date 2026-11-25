/**
 * 부하 테스트용 가짜 사람의 판단 (docs/ops/load-test.md).
 * 서버 봇과 같은 룰 함수(@wmg/rules)를 쓰고, 공유 상태와 본인에게 온 비밀 정보만 본다.
 * 네트워크와 시간은 다루지 않는다. 테스트하기 쉽게 순수 함수로 둔다.
 */
import { botDecide, bulls, gomoku, oneCard, type BidFace, type DieFace } from '@wmg/rules';

/** 이 게임 방 종류로 보낼 메시지 하나. null이면 지금은 할 일이 없다 */
export interface Action {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

// ───────── 공유 상태에서 읽는 부분 (Colyseus가 동기화한 값, 필요한 필드만) ─────────

export interface TurnView {
  readonly phase: string;
  readonly currentTurn: string;
  readonly turnId: string;
}

export interface LiarsView extends TurnView {
  readonly totalDice: number;
  readonly bids: ArrayLike<{ readonly quantity: number; readonly face: number }>;
}

export interface GomokuView extends TurnView {
  readonly board: ArrayLike<number>;
  readonly options: {
    readonly forbidDoubleThree: boolean;
    readonly forbidDoubleFour: boolean;
    readonly forbidOverline: boolean;
  };
}

export interface OneCardView extends TurnView {
  readonly topCard: string;
  readonly chosenSuit: string;
  readonly attack: number;
}

export interface BullsView extends TurnView {
  readonly options: { readonly digits: number };
  readonly history: ArrayLike<{
    readonly playerId: string;
    readonly guess: string;
    readonly strikes: number;
    readonly balls: number;
    readonly skipped: boolean;
  }>;
}

/** 내 차례이고 아직 이 턴에 행동하지 않았는가 */
export function isMyTurn(view: TurnView, myId: string): boolean {
  return view.phase === 'PLAYING' || view.phase === 'BIDDING'
    ? view.currentTurn === myId && view.turnId !== ''
    : false;
}

export function decideLiars(view: LiarsView, myDice: readonly DieFace[]): Action {
  const last = view.bids.length > 0 ? view.bids[view.bids.length - 1] : undefined;
  const currentBid = last ? { quantity: last.quantity, face: last.face as BidFace } : null;
  const decision = botDecide(myDice, { currentBid, totalDice: view.totalDice });
  return decision.type === 'liar'
    ? { type: 'call_liar', payload: { turnId: view.turnId } }
    : {
        type: 'bid',
        payload: { quantity: decision.bid.quantity, face: decision.bid.face, turnId: view.turnId },
      };
}

export function decideGomoku(view: GomokuView, color: gomoku.GomokuColor): Action | null {
  const board = Array.from(view.board) as gomoku.Cell[];
  const move = gomoku.gomokuBotMove(board, color, view.options);
  return move ? { type: 'place', payload: { x: move.x, y: move.y, turnId: view.turnId } } : null;
}

export function decideOneCard(
  view: OneCardView,
  hand: readonly oneCard.Card[],
  drawn: oneCard.Card | null,
): Action {
  const play: oneCard.PlayView = {
    discard: [view.topCard as oneCard.Card],
    chosenSuit: view.chosenSuit === '' ? null : (view.chosenSuit as oneCard.Suit),
    attack: view.attack,
    drawn,
  };
  const action = oneCard.oneCardBotAction(play, hand);
  if (action.type === 'play') {
    return {
      type: 'play',
      payload: {
        card: action.card,
        ...(action.suit ? { suit: action.suit } : {}),
        turnId: view.turnId,
      },
    };
  }
  return { type: action.type, payload: { turnId: view.turnId } };
}

export function decideBulls(view: BullsView, myId: string, mySeat: 0 | 1, pick: bulls.Pick): Action {
  const digits = view.options.digits as bulls.Digits;
  const own: bulls.GuessRecord[] = [];
  for (let i = 0; i < view.history.length; i += 1) {
    const h = view.history[i];
    if (!h || h.playerId !== myId) continue;
    own.push({ seat: mySeat, guess: h.skipped ? null : h.guess, strikes: h.strikes, balls: h.balls });
  }
  return { type: 'guess', payload: { digits: bulls.botGuess(digits, own, pick), turnId: view.turnId } };
}
