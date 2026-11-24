import { describe, expect, it } from 'vitest';
import { gomoku } from '../src/index.js';

const {
  BLACK,
  WHITE,
  DEFAULT_GOMOKU_RULES,
  checkPlace,
  coordLabel,
  emptyBoard,
  forbiddenPoints,
  forbiddenReason,
  gomokuBotMove,
  indexOf,
  isBoardFull,
  parseCoord,
  placeStone,
  winningLine,
} = gomoku;

const RENJU = DEFAULT_GOMOKU_RULES;
const FREE = { forbidDoubleThree: false, forbidDoubleFour: false, forbidOverline: false };

/** "H8" 같은 좌표로 판을 만든다 */
function make(black: string[], white: string[] = []) {
  const board = emptyBoard();
  for (const [list, stone] of [
    [black, BLACK],
    [white, WHITE],
  ] as const) {
    for (const label of list) {
      const p = parseCoord(label);
      if (!p) throw new Error(`bad coord ${label}`);
      board[indexOf(p.x, p.y)] = stone;
    }
  }
  return board;
}

const at = (label: string) => {
  const p = parseCoord(label);
  if (!p) throw new Error(`bad coord ${label}`);
  return p;
};

/** 두고 나서 이긴 줄을 좌표 글자로 */
function playAndWin(board: ReturnType<typeof make>, label: string, color: 'black' | 'white', rules = RENJU) {
  const next = placeStone(board, at(label), color);
  return winningLine(next, at(label), color, rules)?.map(coordLabel) ?? null;
}

describe('오목 좌표 (G-01)', () => {
  it('H8은 가운데(7, 7)이고, 글자와 좌표가 서로 바뀐다', () => {
    expect(at('H8')).toEqual({ x: 7, y: 7 });
    expect(coordLabel({ x: 0, y: 0 })).toBe('A1');
    expect(coordLabel({ x: 14, y: 14 })).toBe('O15');
    expect(parseCoord('P1')).toBeNull();
    expect(parseCoord('A16')).toBeNull();
    expect(parseCoord('h8')).toEqual({ x: 7, y: 7 });
  });
});

describe('착수 검증 (G-03, GE-02, GE-03)', () => {
  it('판 밖이나 정수가 아닌 좌표는 INVALID_MOVE, 돌이 있으면 OCCUPIED', () => {
    const board = make(['H8']);
    expect(checkPlace(board, { x: 15, y: 0 }, 'white', RENJU)).toEqual({ ok: false, code: 'INVALID_MOVE' });
    expect(checkPlace(board, { x: 1.5, y: 0 }, 'white', RENJU)).toEqual({ ok: false, code: 'INVALID_MOVE' });
    expect(checkPlace(board, at('H8'), 'white', RENJU)).toEqual({ ok: false, code: 'OCCUPIED' });
    expect(checkPlace(board, at('H9'), 'white', RENJU)).toEqual({ ok: true });
  });
});

describe('승리 (G-04, G-05, G-06)', () => {
  it('GT-01: 가로·세로·두 대각선 다섯', () => {
    expect(playAndWin(make(['D8', 'E8', 'F8', 'G8']), 'H8', 'black')).toEqual(['D8', 'E8', 'F8', 'G8', 'H8']);
    expect(playAndWin(make(['H4', 'H5', 'H6', 'H7']), 'H8', 'black')).toHaveLength(5);
    expect(playAndWin(make(['D4', 'E5', 'F6', 'G7']), 'H8', 'black')).toHaveLength(5);
    expect(playAndWin(make(['L4', 'K5', 'J6', 'I7']), 'H8', 'white')).toBeNull(); // 흑 돌을 백으로 둔 것
    expect(playAndWin(make([], ['L4', 'K5', 'J6', 'I7']), 'H8', 'white')).toHaveLength(5);
    expect(playAndWin(make(['D8', 'E8', 'F8']), 'H8', 'black')).toBeNull();
  });

  it('GT-02: 백 장목은 승리', () => {
    expect(playAndWin(make([], ['C8', 'D8', 'E8', 'F8', 'G8', 'I8']), 'H8', 'white')).toHaveLength(7);
  });

  it('GT-03: 흑 장목은 장목 금지가 꺼져 있으면 승리, 켜져 있으면 금수', () => {
    const board = make(['C8', 'D8', 'E8', 'F8', 'H8']);
    expect(checkPlace(board, at('G8'), 'black', FREE)).toEqual({ ok: true });
    expect(playAndWin(board, 'G8', 'black', FREE)).toHaveLength(6);
    expect(checkPlace(board, at('G8'), 'black', RENJU)).toEqual({
      ok: false,
      code: 'FORBIDDEN_MOVE',
      reason: 'overline',
    });
  });

  it('GT-04: 흑이 정확히 5이면서 3-3이어도 금수가 아니라 승리', () => {
    // 가로로 다섯이 되면서 세로·대각선으로 열린 3도 생기는 자리
    const board = make(['D8', 'E8', 'F8', 'G8', 'H9', 'H10', 'I9', 'J10']);
    expect(checkPlace(board, at('H8'), 'black', RENJU)).toEqual({ ok: true });
    expect(playAndWin(board, 'H8', 'black')).toHaveLength(5);
  });
});

describe('금수 (G-07~G-10, 흑만)', () => {
  // 세로 H9 H10, 가로 I8 J8 → H8에 두면 열린 3이 둘
  const doubleThree = make(['H9', 'H10', 'I8', 'J8']);

  it('GT-05: 흑 3-3은 3-3 금지가 켜져 있으면 금수, 꺼져 있으면 둘 수 있다', () => {
    expect(checkPlace(doubleThree, at('H8'), 'black', RENJU)).toEqual({
      ok: false,
      code: 'FORBIDDEN_MOVE',
      reason: 'double-three',
    });
    expect(checkPlace(doubleThree, at('H8'), 'black', { ...RENJU, forbidDoubleThree: false })).toEqual({
      ok: true,
    });
  });

  it('GT-06: 한쪽이 막힌 3과 열린 3은 3-3이 아니다', () => {
    const blocked = make(['H9', 'H10', 'I8', 'J8'], ['H11']);
    expect(checkPlace(blocked, at('H8'), 'black', RENJU)).toEqual({ ok: true });
  });

  it('띈 3(X_XX)도 열린 3으로 센다', () => {
    // 세로 H10 H11 (H9 비움) + 가로 I8 J8
    const board = make(['H10', 'H11', 'I8', 'J8']);
    expect(forbiddenReason(board, at('H8'), 'black', RENJU)).toBe('double-three');
  });

  it('GT-07: 두 줄 4-4와 한 줄 4-4(X_XXX_X)는 4-4 금지가 켜져 있으면 금수', () => {
    const twoLines = make(['H9', 'H10', 'H11', 'I8', 'J8', 'K8']);
    expect(forbiddenReason(twoLines, at('H8'), 'black', RENJU)).toBe('double-four');
    expect(forbiddenReason(twoLines, at('H8'), 'black', { ...RENJU, forbidDoubleFour: false })).toBeNull();

    const oneLine = make(['C8', 'E8', 'G8', 'I8']);
    expect(forbiddenReason(oneLine, at('F8'), 'black', RENJU)).toBe('double-four');
  });

  it('열린 4(_XXXX_)는 4 하나라서 금수가 아니다', () => {
    expect(checkPlace(make(['E8', 'F8', 'G8']), at('H8'), 'black', RENJU)).toEqual({ ok: true });
  });

  it('4-3은 금수가 아니다', () => {
    // 세로 4(H9 H10 H11) + 가로 열린 3(I8 J8)
    expect(checkPlace(make(['H9', 'H10', 'H11', 'I8', 'J8']), at('H8'), 'black', RENJU)).toEqual({
      ok: true,
    });
  });

  it('GT-08: 백에게는 금수가 없다', () => {
    const board = make([], ['H9', 'H10', 'I8', 'J8']);
    expect(checkPlace(board, at('H8'), 'white', RENJU)).toEqual({ ok: true });
    expect(forbiddenReason(board, at('H8'), 'white', RENJU)).toBeNull();
  });

  it('금수를 모두 끄면 자유 오목', () => {
    expect(checkPlace(doubleThree, at('H8'), 'black', FREE)).toEqual({ ok: true });
    expect(forbiddenPoints(doubleThree, FREE)).toEqual([]);
  });

  it('G-34: 흑이 둘 수 없는 자리 목록 (화면의 빨간 X)', () => {
    const list = forbiddenPoints(doubleThree, RENJU).map((f) => coordLabel(f.point));
    expect(list).toContain('H8');
  });
});

describe('무승부 (G-11)', () => {
  it('GT-12: 판이 다 차면 가득 찼다고 본다', () => {
    expect(isBoardFull(emptyBoard())).toBe(false);
    expect(isBoardFull(emptyBoard().map((_, i) => (i % 2 ? BLACK : WHITE)))).toBe(true);
  });
});

describe('봇 (G-24)', () => {
  it('첫 수는 가운데', () => {
    expect(gomokuBotMove(emptyBoard(), 'black', RENJU)).toEqual(at('H8'));
  });

  it('이길 수 있으면 이긴다 (막기보다 먼저)', () => {
    // 흑은 D8~G8 넷, 백도 D9~G9 넷: 흑 차례면 막지 않고 이긴다
    const board = make(['D8', 'E8', 'F8', 'G8'], ['D9', 'E9', 'F9', 'G9']);
    const move = gomokuBotMove(board, 'black', RENJU);
    expect(['C8', 'H8']).toContain(move ? coordLabel(move) : '');
  });

  it('상대의 4는 막는다', () => {
    const move = gomokuBotMove(make(['D8', 'E8', 'F8', 'G8'], ['A1']), 'white', RENJU);
    expect(['C8', 'H8']).toContain(move ? coordLabel(move) : '');
  });

  it('흑 봇은 금수에 두지 않는다', () => {
    const board = make(['H9', 'H10', 'I8', 'J8'], ['G7', 'F6']);
    const forbidden = forbiddenPoints(board, RENJU).map((f) => coordLabel(f.point));
    for (let i = 0; i < 5; i += 1) {
      const move = gomokuBotMove(board, 'black', RENJU);
      expect(move).not.toBeNull();
      expect(forbidden).not.toContain(coordLabel(move!));
    }
  });

  it('둘 곳이 없으면 null', () => {
    expect(
      gomokuBotMove(
        emptyBoard().map((_, i) => (i % 2 ? BLACK : WHITE)),
        'white',
        RENJU,
      ),
    ).toBeNull();
  });
});
