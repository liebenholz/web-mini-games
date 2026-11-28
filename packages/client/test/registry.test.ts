import { GAME_ID } from '@wmg/rules';
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/games/catalog.js';
import { findGame, GAMES, gameByRoomType } from '../src/games/registry.js';

describe('게임 목록', () => {
  it('구현된 게임은 모두 플레이할 수 있다', () => {
    expect(GAMES.filter((g) => g.status === 'available').map((g) => g.id)).toEqual([
      'liars-dice',
      'gomoku',
      'one-card',
      'bulls-and-cows',
      'reversi',
      'updown-bomb',
      'balloon',
      'treasure',
    ]);
    expect(findGame('treasure')).toMatchObject({ roomType: 'treasure', category: 'party' });
    expect(findGame('balloon')).toMatchObject({ roomType: 'balloon', category: 'party' });
    expect(findGame('updown-bomb')).toMatchObject({ roomType: 'updown_bomb', category: 'party' });
    expect(findGame('bulls-and-cows')?.roomType).toBe('bulls_and_cows');
    expect(findGame('reversi')?.roomType).toBe('reversi');
    expect(findGame('gomoku')?.roomType).toBe('gomoku');
    expect(findGame('one-card')?.roomType).toBe('one_card');
  });

  it('준비 중인 게임은 방 종류와 규칙이 없다 (누를 수 없음)', () => {
    for (const g of GAMES.filter((x) => x.status !== 'available')) {
      expect(g.roomType).toBeNull();
      expect(g.rules).toBeNull();
    }
  });

  it('플레이 가능한 게임은 서버 방 종류와 규칙이 있다', () => {
    const dice = gameByRoomType(GAME_ID);
    expect(dice?.id).toBe('liars-dice');
    expect(dice?.rules).toBeTypeOf('function');
  });

  it('게임 주소 이름은 영문 소문자와 하이픈이고 겹치지 않는다', () => {
    const ids = CATALOG.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect(ids).not.toContain('r');
  });

  it('확정 문구', () => {
    expect(findGame('liars-dice')?.tagline).toBe('내 주사위를 단서로 거짓말을 잡아내요');
  });
});
