import { describe, expect, it } from 'vitest';
import { thief } from '../src/index.js';

const { fullDeck, createThief, draw, removePairs, isFinished, loserSeat, finalRanks, thiefBotIndex, JOKER } =
  thief;

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
}
function shuffler(seed: number): thief.Shuffle {
  const r = lcg(seed);
  return (cards) => {
    const a = [...cards];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j] as string, a[i] as string];
    }
    return a;
  };
}
const identity: thief.Shuffle = (c) => [...c];

describe('도둑잡기 카드와 나누기 (TF-01~TF-03)', () => {
  it('TA-01: 53장, 조커 1장, 나누면 모든 카드가 한 번씩 (인원 2~6)', () => {
    const deck = fullDeck();
    expect(deck).toHaveLength(53);
    expect(new Set(deck).size).toBe(53);
    expect(deck.filter((c) => c === JOKER)).toHaveLength(1);
    for (let n = 2; n <= 6; n += 1) {
      const dealt = shuffler(n)(deck);
      const s = createThief(dealt, n, n - 1);
      // 첫 짝을 내기 전의 장수: 나눈 뒤 패 + 내려놓은 짝 × 2 = 53
      const left = s.hands.reduce((a, h) => a + h.length, 0);
      expect(left + s.pairs.length * 2).toBe(53);
      // 첫 짝 내기 뒤 남은 장수는 홀수 (조커가 짝이 없으므로)
      expect(left % 2).toBe(1);
      const sizes = Array.from({ length: n }, (_, seat) => {
        let c = 0;
        for (let i = 0; i < 53; i += 1) if ((n - 1 + i) % n === seat) c += 1;
        return c;
      });
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    }
  });

  it('TA-02: 같은 숫자 2, 3, 4장일 때 낸 짝과 남은 장수, 조커는 안 낸다', () => {
    expect(removePairs(['S7', 'H7'])).toEqual({ hand: [], pairs: ['7'] });
    const three = removePairs(['S7', 'H7', 'D7', 'C2']);
    expect(three.pairs).toEqual(['7']);
    expect(three.hand).toHaveLength(2);
    expect(three.hand).toContain('C2');
    const four = removePairs(['S7', 'H7', 'D7', 'C7', JOKER]);
    expect(four.pairs).toEqual(['7', '7']);
    expect(four.hand).toEqual([JOKER]);
  });

  it('시작에서 패를 다 낸 사람은 처음부터 빠진 상태이고 차례는 패가 남은 사람', () => {
    // 2명: 0번 패는 짝만, 1번은 조커 포함. 직접 만든 53장 배열 대신 deal 결과를 검증한다
    for (let seed = 1; seed < 200; seed += 1) {
      const s = createThief(shuffler(seed)(fullDeck()), 4, seed % 4);
      expect(s.out.every((o, i) => o === (s.hands[i]?.length === 0))).toBe(true);
      expect(s.out[s.turn]).toBe(false);
    }
  });
});

describe('도둑잡기 뽑기 (TF-05~TF-09)', () => {
  /** 손으로 만든 상태 */
  const make = (hands: string[][], turn = 0): thief.ThiefState => ({
    players: hands.length,
    hands,
    out: hands.map((h) => h.length === 0),
    outOrder: [],
    pairs: [],
    turn,
    draws: 0,
  });

  it('TA-03: 범위 검사와 차례 검사, 상태는 그대로', () => {
    const s = make([
      ['S3', JOKER],
      ['H3', 'H5', 'D5'],
    ]);
    for (const bad of [-1, 3, 1.5, '0', null])
      expect(draw(s, 0, bad, identity)).toEqual({ ok: false, code: 'INVALID_MOVE' });
    expect(draw(s, 1, 0, identity)).toEqual({ ok: false, code: 'NOT_YOUR_TURN' });
  });

  it('TA-04: 짝이 맞으면 두 장이 내려가고 숫자가 공개된다. 안 맞으면 패가 1장 늘고 공개되지 않는다', () => {
    const s = make([
      ['S3', 'S9', JOKER],
      ['H3', 'H5'],
    ]);
    const hit = draw(s, 0, 0, identity);
    if (!hit.ok) throw new Error(hit.code);
    expect(hit.matched).toBe('3');
    expect(hit.card).toBe('H3');
    expect(hit.state.hands[0]).toHaveLength(2);
    expect(hit.state.hands[1]).toEqual(['H5']);
    expect(hit.state.pairs).toEqual(['3']);
    const miss = draw(s, 0, 1, identity);
    if (!miss.ok) throw new Error(miss.code);
    expect(miss.matched).toBeNull();
    expect(miss.state.hands[0]).toHaveLength(4);
    expect(miss.state.hands[0]).toContain('H5');
    expect(miss.state.pairs).toEqual([]);
  });

  it('TA-03: 뽑은 뒤 양쪽 패에 섞기가 적용된다', () => {
    const s = make([
      ['S3', 'S9', JOKER],
      ['H3', 'H5', 'D8'],
    ]);
    const rev: thief.Shuffle = (c) => [...c].reverse();
    const r = draw(s, 0, 1, rev);
    if (!r.ok) throw new Error(r.code);
    expect(r.state.hands[0]).toEqual(['H5', JOKER, 'S9', 'S3']);
    expect(r.state.hands[1]).toEqual(['D8', 'H3']);
  });

  it('TA-05: 마지막 카드를 빼앗긴 사람도 빠지고, 다음 차례는 빠진 사람을 건너뛴다', () => {
    // 4명. 1번은 카드 1장, 0번이 뽑으면 1번이 빠진다. 다음 차례는 0번 다음 사람(1번)은 빠졌으니 2번
    const s = make([['S3', 'S4', JOKER], ['H9'], ['S5', 'H5', 'D2'], ['D9', 'D2', 'C4']], 0);
    const r = draw(s, 0, 0, identity);
    if (!r.ok) throw new Error(r.code);
    expect(r.targetOut).toBe(true);
    expect(r.state.out[1]).toBe(true);
    expect(r.state.outOrder).toEqual([1]);
    expect(r.state.turn).toBe(2);
    // 2번은 3번에게서 뽑는다
    expect(thief.targetOf(r.state, 2)).toBe(3);
    // 3번 다음 대상은 0번 (1번 건너뜀)
    expect(thief.targetOf(r.state, 3)).toBe(0);
  });

  it('뽑은 사람이 짝을 내고 0장이 되면 빠진다 (TF-08)', () => {
    const s = make([['S3'], ['H3', JOKER]]);
    const r = draw(s, 0, 0, identity);
    if (!r.ok) throw new Error(r.code);
    expect(r.matched).toBe('3');
    expect(r.drawerOut).toBe(true);
    expect(r.state.out).toEqual([true, false]);
    expect(isFinished(r.state)).toBe(true);
    expect(loserSeat(r.state)).toBe(1);
    expect(finalRanks(r.state)).toEqual([1, 2]);
    expect(draw(r.state, 1, 0, identity)).toEqual({ ok: false, code: 'GAME_OVER' });
  });

  it('TA-10: 2명 시작과 조커를 뽑은 경우는 계속된다', () => {
    const s = make([['S3', JOKER], ['H3']], 1);
    const r = draw(s, 1, 1, identity);
    if (!r.ok) throw new Error(r.code);
    // 1번이 0번의 조커를 뽑는다: 1번 패 H3 + 조커, 0번 패 S3
    expect(r.matched).toBeNull();
    expect(r.state.hands[1]).toHaveLength(2);
    expect(r.state.turn).toBe(0);
    expect(isFinished(r.state)).toBe(false);
  });
});

describe('도둑잡기 끝까지 (TF-10, TF-13)', () => {
  it('TA-06, TA-09: 봇끼리 1,000판 모두 끝나고, 마지막 한 명은 조커 한 장만 든다', () => {
    const roll = lcg(99);
    for (let game = 0; game < 1000; game += 1) {
      const players = 2 + (game % 5);
      const sh = shuffler(game + 1);
      let s = createThief(sh(fullDeck()), players, game % players);
      let guard = 0;
      while (!isFinished(s) && guard < 500) {
        const target = thief.targetOf(s, s.turn);
        const idx = thiefBotIndex(s.hands[target]?.length ?? 0, roll());
        const r = draw(s, s.turn, idx, sh);
        if (!r.ok) throw new Error(r.code);
        s = r.state;
        guard += 1;
      }
      expect(isFinished(s)).toBe(true);
      const loser = loserSeat(s);
      expect(loser).not.toBeNull();
      expect(s.hands[loser as number]).toEqual([JOKER]);
      expect(s.hands.filter((h) => h.length > 0)).toHaveLength(1);
      // 모든 카드가 한 번씩: 남은 1장 + 내려놓은 짝 × 2
      expect(1 + s.pairs.length * 2).toBe(53);
    }
  });

  it('봇 위치는 범위 안', () => {
    expect(thiefBotIndex(5, 0)).toBe(0);
    expect(thiefBotIndex(5, 0.999999)).toBe(4);
    expect(thiefBotIndex(0, 0.5)).toBe(0);
  });
});

describe('도둑잡기 옵션 (3장)', () => {
  it('기본값 4명, 15초, 봇 채우기, 비공개. 2~6명, 10/15/30초만 허용', () => {
    expect(thief.DEFAULT_THIEF_OPTIONS).toEqual({
      maxPlayers: 4,
      turnSeconds: 15,
      fillWithBots: true,
      isPrivate: true,
    });
    expect(thief.parseThiefOptions({ maxPlayers: 7 })).toMatchObject({ ok: false, field: 'maxPlayers' });
    expect(thief.parseThiefOptions({ maxPlayers: 1 })).toMatchObject({ ok: false, field: 'maxPlayers' });
    expect(thief.parseThiefOptions({ maxPlayers: 6 })).toMatchObject({ ok: true });
    expect(thief.parseThiefOptions({ turnSeconds: 20 })).toMatchObject({ ok: false, field: 'turnSeconds' });
    expect(thief.parseThiefOptions({ isPrivate: 1 })).toMatchObject({ ok: false, field: 'isPrivate' });
    expect(thief.parseThiefOptions({ turnSeconds: 30, foo: 1 })).toEqual({
      ok: true,
      options: { ...thief.DEFAULT_THIEF_OPTIONS, turnSeconds: 30 },
    });
  });
});
