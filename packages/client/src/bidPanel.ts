import {
  BID_FACES,
  canCallLiar,
  isValidBid,
  minimumQuantityForFace,
  minimumRaise,
  type Bid,
  type BidFace,
} from '@wmg/rules';

/**
 * 선언 패널의 활성/비활성 계산 (명세 8장, TC-05).
 * 판정은 서버가 한다. 여기서는 rules의 같은 함수로 불가능한 값을 미리 막을 뿐이다 (원칙 1, 2).
 */
export interface PanelInput {
  readonly currentBid: Bid | null;
  readonly totalDice: number;
  readonly myTurn: boolean;
}

export interface PanelSelection {
  readonly quantity: number;
  readonly face: BidFace;
}

export interface PanelState {
  readonly selection: PanelSelection | null;
  readonly faceEnabled: Readonly<Record<BidFace, boolean>>;
  readonly canDecrease: boolean;
  readonly canIncrease: boolean;
  readonly canBid: boolean;
  readonly canLiar: boolean;
  /** R-11: 더 올릴 수 없어 라이어만 가능 */
  readonly liarOnly: boolean;
}

/** 기본값: 가장 낮은 합법 선언 (S-06과 같은 계산) */
export function defaultSelection(input: PanelInput): PanelSelection | null {
  const raise = minimumRaise(input.currentBid, input.totalDice);
  return raise ? { quantity: raise.quantity, face: raise.face } : null;
}

/** 사용자가 고른 값을 유지하되, 불가능해지면 가장 가까운 합법 값으로 당긴다 */
export function normalizeSelection(input: PanelInput, wanted: PanelSelection | null): PanelSelection | null {
  if (!wanted) return defaultSelection(input);
  if (isValidBid(input.currentBid, wanted, input.totalDice).ok) return wanted;
  const min = minimumQuantityForFace(input.currentBid, wanted.face, input.totalDice);
  if (min !== null)
    return { quantity: Math.max(min, Math.min(wanted.quantity, input.totalDice)), face: wanted.face };
  return defaultSelection(input);
}

export function panelState(input: PanelInput, wanted: PanelSelection | null): PanelState {
  const selection = normalizeSelection(input, wanted);
  const faceEnabled = Object.fromEntries(
    BID_FACES.map((f) => [f, minimumQuantityForFace(input.currentBid, f, input.totalDice) !== null]),
  ) as Record<BidFace, boolean>;
  const canBid =
    input.myTurn && selection !== null && isValidBid(input.currentBid, selection, input.totalDice).ok;
  const lower = selection ? { quantity: selection.quantity - 1, face: selection.face } : null;
  const higher = selection ? { quantity: selection.quantity + 1, face: selection.face } : null;
  return {
    selection,
    faceEnabled,
    canDecrease: input.myTurn && lower !== null && isValidBid(input.currentBid, lower, input.totalDice).ok,
    canIncrease: input.myTurn && higher !== null && isValidBid(input.currentBid, higher, input.totalDice).ok,
    canBid,
    canLiar: input.myTurn && canCallLiar(input.currentBid).ok,
    liarOnly: input.currentBid !== null && minimumRaise(input.currentBid, input.totalDice) === null,
  };
}
