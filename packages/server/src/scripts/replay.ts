/**
 * M3: 저장된 rounds와 bids로 판을 재현해 룰과 일치하는지 확인한다.
 * 사용: DATABASE_URL=... pnpm --filter server replay <game-id>   (game-id 생략 시 최근 판)
 */
import pg from 'pg';
import type { RoomOptions } from '@wmg/rules';
import { replayGame } from '../persistence/replay.js';
import type { BidRecord, RoundRecord } from '../persistence/types.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url });
try {
  const arg = process.argv[2];
  const game = arg
    ? await pool.query<{ id: string; options: RoomOptions }>('SELECT id, options FROM games WHERE id = $1', [
        arg,
      ])
    : await pool.query<{ id: string; options: RoomOptions }>(
        'SELECT id, options FROM games ORDER BY ended_at DESC LIMIT 1',
      );
  const row = game.rows[0];
  if (!row) throw new Error('game not found');
  const players = await pool.query<{ seat: number; final_rank: number }>(
    'SELECT seat, final_rank FROM game_players WHERE game_id = $1',
    [row.id],
  );
  const rounds = await pool.query<{
    round_no: number;
    starter_seat: number;
    dice: RoundRecord['dice'];
    result: RoundRecord['result'];
  }>('SELECT round_no, starter_seat, dice, result FROM rounds WHERE game_id = $1 ORDER BY round_no', [
    row.id,
  ]);
  const bids = await pool.query<{
    round_no: number;
    seq: number;
    seat: number;
    quantity: number;
    face: BidRecord['face'];
    is_auto: boolean;
    created_at: Date;
  }>(
    'SELECT round_no, seq, seat, quantity, face, is_auto, created_at FROM bids WHERE game_id = $1 ORDER BY seq',
    [row.id],
  );
  const result = replayGame({
    startingDice: row.options.startingDice,
    players: players.rows.map((p) => ({ seat: p.seat, finalRank: p.final_rank })),
    rounds: rounds.rows.map((r) => ({
      roundNo: r.round_no,
      starterSeat: r.starter_seat,
      dice: r.dice,
      result: r.result,
    })),
    bids: bids.rows.map((b) => ({
      roundNo: b.round_no,
      seq: b.seq,
      seat: b.seat,
      quantity: b.quantity,
      face: b.face,
      isAuto: b.is_auto,
      createdAt: b.created_at,
    })),
  });
  console.log(`game ${row.id}: ${rounds.rowCount} rounds, ${bids.rowCount} bids`);
  console.log(
    result.ok ? 'replay OK — matches stored results' : `replay FAILED:\n- ${result.problems.join('\n- ')}`,
  );
  console.log('ranking:', result.ranking.map((r) => `seat ${r.seat} → ${r.rank}`).join(', '));
  process.exitCode = result.ok ? 0 : 2;
} finally {
  await pool.end();
}
