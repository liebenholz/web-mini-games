import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/games/catalog.js';
import type { GameInfo } from '../src/games/registry.js';
import { invitePath, lobbyPath, parseRoute } from '../src/routes.js';

const games: GameInfo[] = CATALOG.map((g) => ({
  ...g,
  roomType: g.status === 'available' ? g.id : null,
  rules: null,
  flow: null,
}));
const route = (path: string) => parseRoute(path, games, 'liars-dice');

describe('주소 체계 (ADR 0002)', () => {
  it('/ 는 메인(게임 선택)', () => {
    expect(route('/').kind).toBe('hub');
    expect(route('').kind).toBe('hub');
  });

  it('/<게임> 은 그 게임 로비, 끝 슬래시도 허용', () => {
    for (const p of ['/liars-dice', '/liars-dice/']) {
      const r = route(p);
      expect(r.kind).toBe('lobby');
      if (r.kind === 'lobby') expect(r.game.id).toBe('liars-dice');
    }
  });

  it('/<게임>/r/<코드> 는 초대 링크, 코드는 대문자로 정리한다', () => {
    const r = route('/liars-dice/r/abc234');
    expect(r).toMatchObject({ kind: 'invite', code: 'ABC234' });
    if (r.kind === 'invite') expect(r.game.id).toBe('liars-dice');
  });

  it('Phase 1 초대 링크 /r/<코드> 는 거짓말쟁이 주사위로 간다', () => {
    const r = route('/r/ABC234');
    expect(r).toMatchObject({ kind: 'invite', code: 'ABC234' });
    if (r.kind === 'invite') expect(r.game.id).toBe('liars-dice');
  });

  it('잘못된 방 코드는 code가 null인 초대 링크', () => {
    expect(route('/liars-dice/r/O0I1')).toMatchObject({ kind: 'invite', code: null });
  });

  it('준비 중인 게임은 로비와 초대 링크 모두 coming-soon', () => {
    expect(route('/gomoku').kind).toBe('lobby');
    expect(route('/one-card').kind).toBe('coming-soon');
    expect(route('/one-card/r/ABC234').kind).toBe('coming-soon');
  });

  it('없는 게임이나 이상한 경로는 not-found', () => {
    for (const p of ['/chess', '/liars-dice/x', '/liars-dice/r', '/r', '/liars-dice/r/ABC234/extra'])
      expect(route(p).kind, p).toBe('not-found');
  });

  it('주소 만들기와 해석이 서로 맞는다', () => {
    const game = games[0]!;
    expect(route(lobbyPath(game))).toMatchObject({ kind: 'lobby' });
    expect(route(invitePath(game, 'XYZ789'))).toMatchObject({ kind: 'invite', code: 'XYZ789' });
  });
});
