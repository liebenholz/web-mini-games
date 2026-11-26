import { describe, expect, it } from 'vitest';
import { reversi } from '../src/index.js';

const {
  BLACK,
  WHITE,
  EMPTY,
  DEFAULT_REVERSI_OPTIONS,
  coordLabel,
  countStones,
  emptyBoard,
  flipsAt,
  hasLegalMove,
  indexOf,
  initialBoard,
  legalMoves,
  nextTurn,
  parseCoord,
  parseReversiOptions,
  placeStone,
  reversiBotMove,
  winnerOf,
} = reversi;

type Cell = reversi.Cell;

/** "D3" 같은 좌표로 판을 만든다 */
function make(black: string[], white: string[] = []): Cell[] {
  const board = emptyBoard();
  for (const [list, stone] of [
    [black, BLACK],
    [white, WHITE],
  ] as const) {
    for (const label of list) board[indexOf(parseCoord(label)!)] = stone;
  }
  return board;
}

const labels = (ps: readonly reversi.Point[]) => ps.map(coordLabel).sort();

describe('리버시 판 (RV-01)', () => {
  it('RV-01: 처음 배치는 D4 백, E4 흑, D5 흑, E5 백', () => {
    const b = initialBoard();
    expect(b[indexOf(parseCoord('D4')!)]).toBe(WHITE);
    expect(b[indexOf(parseCoord('E4')!)]).toBe(BLACK);
    expect(b[indexOf(parseCoord('D5')!)]).toBe(BLACK);
    expect(b[indexOf(parseCoord('E5')!)]).toBe(WHITE);
    expect(countStones(b)).toEqual({ black: 2, white: 2 });
  });

  it('좌표 이름: 열 A~H, 행 1~8 (위→아래)', () => {
    expect(coordLabel({ x: 0, y: 0 })).toBe('A1');
    expect(coordLabel({ x: 7, y: 7 })).toBe('H8');
    expect(parseCoord('h8')).toEqual({ x: 7, y: 7 });
    expect(parseCoord('I1')).toBeNull();
    expect(parseCoord('A9')).toBeNull();
  });
});

describe('리버시 착수 (RV-02~RV-04)', () => {
  it('RT-01: 흑의 첫 합법 수는 D3, C4, F5, E6 네 곳', () => {
    expect(labels(legalMoves(initialBoard(), 'black'))).toEqual(['C4', 'D3', 'E6', 'F5']);
  });

  it('RV-03: 두면 끼인 돌이 뒤집힌다', () => {
    const r = placeStone(initialBoard(), parseCoord('D3')!, 'black');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(labels(r.flips)).toEqual(['D4']);
    expect(r.board[indexOf(parseCoord('D4')!)]).toBe(BLACK);
    expect(countStones(r.board)).toEqual({ black: 4, white: 1 });
  });

  it('RT-02: 한 수로 여러 방향을 동시에 뒤집는다', () => {
    // D4 자리에 흑을 두면 오른쪽(E4,F4), 아래(D5), 대각선(E5)이 모두 뒤집힌다
    const b = make(['G4', 'D6', 'F6'], ['E4', 'F4', 'D5', 'E5']);
    expect(labels(flipsAt(b, parseCoord('D4')!, 'black'))).toEqual(['D5', 'E4', 'E5', 'F4']);
  });

  it('RV-03: 내 돌로 끝나지 않는 방향은 뒤집지 않는다', () => {
    // 오른쪽은 B1(백) 다음 C1이 빈칸, 아래는 A2(백) 다음 A3 흑
    const b = make(['A3'], ['B1', 'A2']);
    expect(labels(flipsAt(b, { x: 0, y: 0 }, 'black'))).toEqual(['A2']);
  });

  it('RT-03: 뒤집을 돌이 없는 칸, 돌이 있는 칸, 판 밖은 INVALID_MOVE이고 판은 그대로', () => {
    const b = initialBoard();
    const before = b.slice();
    expect(placeStone(b, parseCoord('A1')!, 'black')).toEqual({ ok: false, code: 'INVALID_MOVE' });
    expect(placeStone(b, parseCoord('D4')!, 'black')).toEqual({ ok: false, code: 'INVALID_MOVE' });
    expect(placeStone(b, { x: 8, y: 0 }, 'black')).toEqual({ ok: false, code: 'INVALID_MOVE' });
    expect(placeStone(b, { x: -1, y: 3 }, 'black')).toEqual({ ok: false, code: 'INVALID_MOVE' });
    expect(placeStone(b, { x: 1.5, y: 3 }, 'black')).toEqual({ ok: false, code: 'INVALID_MOVE' });
    expect(b).toEqual(before);
  });
});

describe('리버시 넘김과 끝 (RV-05~RV-07)', () => {
  it('RT-04: 상대가 둘 곳이 없으면 넘기고 다시 내 차례', () => {
    // 흑 A1~D1, 백 E1·H8. 백은 흑을 끼울 곳이 없고(왼쪽 끝이 판 밖), 흑은 F1에 두어 E1을 뒤집는다
    const b = make(['A1', 'B1', 'C1', 'D1'], ['E1', 'H8']);
    expect(hasLegalMove(b, 'white')).toBe(false);
    expect(hasLegalMove(b, 'black')).toBe(true);
    expect(nextTurn(b, 'black')).toEqual({ next: 'black', passed: 'white' });
  });

  it('RV-05: 상대가 둘 수 있으면 그냥 상대 차례', () => {
    expect(nextTurn(initialBoard(), 'black')).toEqual({ next: 'white', passed: null });
  });

  it('RT-05: 둘 다 둘 곳이 없으면 끝, 많은 쪽이 이긴다', () => {
    const b = make(['A1', 'B1'], ['H8']);
    expect(nextTurn(b, 'black')).toEqual({ next: null, passed: null });
    expect(winnerOf(b)).toBe('black');
  });

  it('RT-05: 판이 다 차면 끝, 같은 수면 무승부', () => {
    const b = emptyBoard().map((_, i) => (i < 32 ? BLACK : WHITE)) as Cell[];
    expect(nextTurn(b, 'white')).toEqual({ next: null, passed: null });
    expect(countStones(b)).toEqual({ black: 32, white: 32 });
    expect(winnerOf(b)).toBeNull();
  });
});

describe('리버시 옵션 (3장)', () => {
  it('기본값: 흑 무작위, 30초, 봇 채우기, 비공개', () => {
    expect(DEFAULT_REVERSI_OPTIONS).toEqual({
      blackPolicy: 'random',
      turnSeconds: 30,
      fillWithBots: true,
      isPrivate: true,
    });
  });

  it('범위 밖 값은 거부하고 모르는 키는 무시한다', () => {
    expect(parseReversiOptions({ turnSeconds: 45 })).toMatchObject({ ok: false, field: 'turnSeconds' });
    expect(parseReversiOptions({ blackPolicy: 'me' })).toMatchObject({ ok: false, field: 'blackPolicy' });
    expect(parseReversiOptions({ fillWithBots: 'yes' })).toMatchObject({ ok: false, field: 'fillWithBots' });
    expect(parseReversiOptions([])).toMatchObject({ ok: false, field: 'input' });
    expect(parseReversiOptions({ turnSeconds: 15, blackPolicy: 'host', foo: 1 })).toEqual({
      ok: true,
      options: { ...DEFAULT_REVERSI_OPTIONS, turnSeconds: 15, blackPolicy: 'host' },
    });
  });
});

describe('리버시 봇 (RV-13)', () => {
  it('모서리를 잡을 수 있으면 잡는다', () => {
    // 흑이 A1에 두면 B2(백)를 C3(흑)과 끼운다
    const b = make(['C3', 'D4'], ['B2', 'E4']);
    expect(coordLabel(reversiBotMove(b, 'black')!)).toBe('A1');
  });

  it('둘 곳이 없으면 null', () => {
    expect(reversiBotMove(make(['A1'], ['H8']), 'black')).toBeNull();
  });

  it('같은 점수면 roll로 고른다', () => {
    // 첫 수 네 곳은 모두 같은 점수 (대칭)
    const picks = new Set(
      [0, 0.3, 0.6, 0.99].map((r) => coordLabel(reversiBotMove(initialBoard(), 'black', r)!)),
    );
    expect(picks.size).toBe(4);
  });

  it('RT-07: 봇끼리 1,000판을 두면 모두 끝나고 항상 합법 수만 둔다', () => {
    let seed = 1;
    const roll = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296;
    };
    let draws = 0;
    let passes = 0;
    for (let game = 0; game < 1000; game += 1) {
      let board: Cell[] = initialBoard();
      let turn: reversi.ReversiColor | null = 'black';
      let moves = 0;
      while (turn) {
        const p = reversiBotMove(board, turn, roll());
        expect(p).not.toBeNull();
        const r = placeStone(board, p!, turn);
        expect(r.ok).toBe(true);
        if (!r.ok) break;
        board = r.board;
        moves += 1;
        const n = nextTurn(board, turn);
        if (n.passed) passes += 1;
        turn = n.next;
      }
      expect(moves).toBeLessThanOrEqual(60);
      expect(hasLegalMove(board, 'black') || hasLegalMove(board, 'white')).toBe(false);
      const { black, white } = countStones(board);
      expect(black + white + board.filter((c) => c === EMPTY).length).toBe(64);
      if (winnerOf(board) === null) draws += 1;
    }
    expect(draws).toBeLessThan(1000);
    expect(passes).toBeGreaterThan(0);
  });
});
