import {
  aliveSeats,
  applyLoss,
  createTable,
  isGameOver,
  isValidBid,
  nextStarter,
  nextTurnSeat,
  ranking,
  resolveLiar,
  totalDice,
  type Bid,
  type TableState,
} from '@wmg/rules';
import type { BidRecord, GamePlayerRecord, RoundRecord } from './types.js';

export interface ReplayInput {
  readonly startingDice: number;
  readonly players: readonly Pick<GamePlayerRecord, 'seat' | 'finalRank'>[];
  readonly rounds: readonly RoundRecord[];
  readonly bids: readonly BidRecord[];
}

export interface ReplayResult {
  readonly ok: boolean;
  readonly problems: string[];
  readonly ranking: ReadonlyArray<{ seat: number; rank: number | null }>;
}

/**
 * M3: 저장된 rounds와 bids만으로 판을 처음부터 다시 진행해 기록이 룰과 일치하는지 확인한다.
 * 선언 순서·합법성, 공개 판정, 패배자, 다음 선, 최종 순위를 모두 다시 계산한다.
 */
export function replayGame(input: ReplayInput): ReplayResult {
  const problems: string[] = [];
  let table: TableState = createTable(
    input.players.map((p) => p.seat),
    input.startingDice,
  );
  const rounds = [...input.rounds].sort((a, b) => a.roundNo - b.roundNo);
  let expectedStarter: number | null = null;

  for (const round of rounds) {
    const where = `round ${round.roundNo}`;
    if (expectedStarter !== null && round.starterSeat !== expectedStarter) {
      problems.push(`${where}: starter ${round.starterSeat}, expected ${expectedStarter} (R-04)`);
    }
    for (const d of round.dice) {
      const count = table.players.find((p) => p.seat === d.seat)?.diceCount;
      if (count !== d.dice.length)
        problems.push(`${where}: seat ${d.seat} rolled ${d.dice.length} dice, expected ${count}`);
    }
    const total = totalDice(table);
    const bids = input.bids.filter((b) => b.roundNo === round.roundNo).sort((a, b) => a.seq - b.seq);
    let prev: Bid | null = null;
    let turn = round.starterSeat;
    let lastBidder = -1;
    for (const b of bids) {
      if (b.seat !== turn)
        problems.push(`${where}: bid seq ${b.seq} by seat ${b.seat}, expected seat ${turn} (R-02)`);
      const check = isValidBid(prev, b, total);
      if (!check.ok) problems.push(`${where}: bid seq ${b.seq} invalid (${check.reason})`);
      prev = { quantity: b.quantity, face: b.face };
      lastBidder = b.seat;
      turn = nextTurnSeat(b.seat, aliveSeats(table));
    }
    if (!prev) {
      problems.push(`${where}: no bids before liar (R-06)`);
      continue;
    }
    const r = round.result;
    if (r.bidderSeat !== lastBidder)
      problems.push(`${where}: bidder ${r.bidderSeat}, expected ${lastBidder}`);
    if (r.callerSeat !== turn) problems.push(`${where}: caller ${r.callerSeat}, expected ${turn} (R-08)`);
    const recomputed = resolveLiar(prev, round.dice, lastBidder, turn);
    if (recomputed.actual !== r.actual || recomputed.loserSeat !== r.loserSeat) {
      problems.push(
        `${where}: result mismatch (actual ${recomputed.actual}/${r.actual}, loser ${recomputed.loserSeat}/${r.loserSeat})`,
      );
    }
    table = applyLoss(table, recomputed.loserSeat);
    expectedStarter = isGameOver(table) ? null : nextStarter(recomputed.loserSeat, aliveSeats(table));
  }

  if (!isGameOver(table)) problems.push('game did not reach a single survivor');
  const ranks = ranking(table);
  for (const p of input.players) {
    const rank = ranks.find((r) => r.seat === p.seat)?.rank;
    if (rank !== p.finalRank) problems.push(`seat ${p.seat}: final rank ${p.finalRank}, replay ${rank}`);
  }
  return { ok: problems.length === 0, problems, ranking: ranks };
}
