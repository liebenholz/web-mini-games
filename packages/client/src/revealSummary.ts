import { nextStarter, nextTurnSeat, type BidFace } from '@wmg/rules';
import { withSubject } from './josa.js';
import type { BidView, PlayerView, RevealView } from './net.js';

/**
 * 공개(REVEAL) 결과를 사람이 읽을 수 있게 정리한 것 (판정 요약 패널, 직전 판정 다시 보기).
 * 판정 자체는 서버가 했다. 여기서는 받은 주사위와 공개 정보로 설명만 만든다 (원칙 1).
 */
export interface RevealSummary {
  readonly roundNo: number;
  readonly face: BidFace;
  readonly quantity: number;
  /** 선언한 눈 그대로인 주사위 수 */
  readonly faceCount: number;
  /** 와일드로 함께 센 1의 수 (R-09) */
  readonly wildCount: number;
  readonly actual: number;
  readonly succeeded: boolean;
  readonly bidderId: string;
  readonly callerId: string;
  readonly loserId: string;
  /** 이번 패배로 주사위가 0개가 되어 탈락 (R-12) */
  readonly loserEliminated: boolean;
  /** 다음 라운드 선 (R-04). 이번 판정으로 게임이 끝나면 null */
  readonly nextStarterId: string | null;
}

/**
 * @param players 공개 시점(패배 반영 전)의 공유 상태
 * @param bids 이번 라운드 선언 기록 (마지막이 판정 대상)
 */
export function summarizeReveal(
  reveal: RevealView,
  players: readonly PlayerView[],
  bids: readonly BidView[],
): RevealSummary {
  const face = reveal.bid.face;
  let faceCount = 0;
  let wildCount = 0;
  for (const d of reveal.dice) {
    for (const v of d.dice) {
      if (v === face) faceCount += 1;
      else if (v === 1) wildCount += 1;
    }
  }

  const seatOf = new Map(reveal.dice.map((d) => [d.playerId, d.seat]));
  const idAt = new Map(reveal.dice.map((d) => [d.seat, d.playerId]));
  const alive = reveal.dice.map((d) => d.seat);
  const loserSeat = seatOf.get(reveal.loserId) ?? -1;

  // 선언자는 마지막 선언을 한 사람, 라이어는 시계 방향으로 바로 다음 생존자다 (R-08)
  const bidderId =
    bids.at(-1)?.playerId ?? (reveal.bidSucceeded ? previousSeatId(loserSeat, alive, idAt) : reveal.loserId);
  const bidderSeat = seatOf.get(bidderId) ?? loserSeat;
  const callerId = idAt.get(nextTurnSeat(bidderSeat, alive)) ?? reveal.loserId;

  const loserBefore = players.find((p) => p.id === reveal.loserId)?.diceCount ?? 0;
  const loserEliminated = loserBefore <= 1;
  const aliveAfter = loserEliminated ? alive.filter((s) => s !== loserSeat) : alive;
  const nextStarterId =
    aliveAfter.length <= 1 ? null : (idAt.get(nextStarter(loserSeat, aliveAfter)) ?? null);

  return {
    roundNo: reveal.roundNo,
    face,
    quantity: reveal.bid.quantity,
    faceCount,
    wildCount,
    actual: reveal.actual,
    succeeded: reveal.bidSucceeded,
    bidderId,
    callerId,
    loserId: reveal.loserId,
    loserEliminated,
    nextStarterId,
  };
}

function previousSeatId(seat: number, alive: readonly number[], idAt: Map<number, string>): string {
  const sorted = [...alive].sort((a, b) => a - b);
  const before = [...sorted].reverse().find((s) => s < seat) ?? sorted.at(-1);
  return before === undefined ? '' : (idAt.get(before) ?? '');
}

/** 요약 문장들. me면 "나"로 부른다 */
export interface RevealText {
  /** "봇 1의 선언 · 봇 2가 라이어!" (캔버스용은 이름을 줄인다) */
  readonly bidderPart: string;
  readonly callerPart: string;
  /** "4가 9개 이상" */
  readonly bidPart: string;
  readonly verdict: string;
  /** "13개 ≥ 선언 9개라서 선언이 맞았어요." */
  readonly reason: string;
  /** "봇 2가 주사위를 잃어요" / "봇 2가 탈락해요" */
  readonly loss: string;
  /** "다음 선은 봇 2" / "게임이 끝나요" */
  readonly next: string;
}

export function describeReveal(
  s: RevealSummary,
  players: readonly PlayerView[],
  me: string,
  maxNameLength = Infinity,
): RevealText {
  const name = (id: string): string => {
    const raw = players.find((p) => p.id === id)?.nickname ?? '?';
    const chars = [...raw];
    return chars.length > maxNameLength ? `${chars.slice(0, maxNameLength).join('')}…` : raw;
  };
  const subject = (id: string): string => (id === me ? '내가' : withSubject(name(id)));
  const possessive = (id: string): string => (id === me ? '내' : `${name(id)}의`);
  return {
    bidderPart: `${possessive(s.bidderId)} 선언`,
    callerPart: `${subject(s.callerId)} 라이어!`,
    bidPart: `${withSubject(String(s.face))} ${s.quantity}개 이상`,
    verdict: s.succeeded ? '선언 성공' : '거짓말!',
    reason: s.succeeded
      ? `${s.actual}개 ≥ 선언 ${s.quantity}개라서 선언이 맞았어요.`
      : `${s.actual}개 < 선언 ${s.quantity}개라서 선언이 틀렸어요.`,
    loss: s.loserEliminated ? `${subject(s.loserId)} 탈락해요` : `${subject(s.loserId)} 주사위를 잃어요`,
    next:
      s.nextStarterId === null
        ? '게임이 끝나요'
        : `다음 선은 ${s.nextStarterId === me ? '나' : name(s.nextStarterId)}`,
  };
}
