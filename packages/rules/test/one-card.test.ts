import { describe, expect, it } from 'vitest';
import { oneCard } from '../src/index.js';

type State = oneCard.OneCardState;
const env: oneCard.OneCardEnv = { shuffle: (cards) => [...cards] };

/** 테스트용 상태. 지정하지 않은 값은 기본값 (4인, 덱 넉넉히) */
function mk(patch: Partial<State> & { hands: string[][] }): State {
  const n = patch.hands.length;
  return {
    deck: ['S3', 'S4', 'S5', 'S6', 'S8', 'S9', 'S10', 'H3', 'H4', 'H6'],
    discard: ['H5'],
    chosenSuit: null,
    attack: 0,
    direction: 1,
    turn: 0,
    drawn: null,
    status: Array.from({ length: n }, () => 'playing' as const),
    finishOrder: [],
    bankruptOrder: [],
    over: false,
    ...patch,
  };
}

function ok(r: oneCard.OneCardResult): { state: State; events: readonly oneCard.OneCardEvent[] } {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
  return r;
}

const other = [
  ['C9', 'C10'],
  ['D9', 'D10'],
  ['S9', 'S10'],
];

describe('원카드 카드 (C-01~C-04)', () => {
  it('C-01: 54장, 겹치지 않고, 조커 2장', () => {
    const deck = oneCard.fullDeck();
    expect(deck).toHaveLength(54);
    expect(new Set(deck).size).toBe(54);
    expect(deck.filter(oneCard.isJoker)).toEqual(['JB', 'JC']);
    expect(deck.every(oneCard.isCard)).toBe(true);
    expect(oneCard.isCard('S11')).toBe(false);
    expect(oneCard.isCard('X7')).toBe(false);
  });

  it('C-03: 한 사람당 7장, C-05: 첫 차례는 받은 값', () => {
    const s = oneCard.startOneCard(oneCard.fullDeck(), 4, 2);
    expect(s.hands.map((h) => h.length)).toEqual([7, 7, 7, 7]);
    expect(s.turn).toBe(2);
    expect(s.deck.length + 1 + 28).toBe(54);
  });

  it('CT-02 C-04: 첫 카드가 특수 카드면 덱 맨 아래로 넣고 숫자 카드가 나올 때까지 다시 편다', () => {
    const dealt = Array.from({ length: 14 }, (_, i) => `C${['3', '4', '5', '6', '8', '9', '10'][i % 7]}`);
    const deck = [...dealt, 'SA', 'S7', 'JB', 'SK', 'H4', 'H5'];
    const s = oneCard.startOneCard(deck, 2, 0);
    expect(oneCard.topCard(s)).toBe('H4');
    expect(s.deck).toEqual(['H5', 'SA', 'S7', 'JB', 'SK']);
  });

  it('C-20: 공격 장수', () => {
    expect(['H2', 'SA', 'JB', 'JC', 'S7', 'SK'].map(oneCard.attackValue)).toEqual([2, 3, 5, 7, 0, 0]);
  });
});

describe('내기 (C-10~C-14)', () => {
  it('CT-01 C-10: 맨 위 ♥5에 ♥9 / ♠5 / ♠9', () => {
    const s = mk({ hands: [['H9', 'S5', 'S9'], ...other] });
    expect(ok(oneCard.playCard(s, 0, 'H9', undefined)).state.turn).toBe(1);
    expect(oneCard.playCard(s, 0, 'S5', undefined).ok).toBe(true);
    expect(oneCard.playCard(s, 0, 'S9', undefined)).toEqual({ ok: false, code: 'INVALID_CARD' });
  });

  it('CE-01: 내 차례가 아니면 NOT_YOUR_TURN, CE-02: 내 패에 없으면 INVALID_CARD', () => {
    const s = mk({ hands: [['H9'], ['H8'], ...other.slice(1)] });
    expect(oneCard.playCard(s, 1, 'H8', undefined)).toEqual({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(oneCard.playCard(s, 0, 'H8', undefined)).toEqual({ ok: false, code: 'INVALID_CARD' });
  });

  it('C-10: 조커는 언제나 낼 수 있다, C-11: 조커 다음(공격 끝)은 아무 카드나', () => {
    const s = mk({ hands: [['JB', 'S9'], ...other] });
    expect(oneCard.playCard(s, 0, 'JB', undefined).ok).toBe(true);
    const afterJoker = mk({ hands: [['S9', 'C3'], ...other], discard: ['H5', 'JB'] });
    expect(oneCard.playCard(afterJoker, 0, 'S9', undefined).ok).toBe(true);
  });

  it('CT-03 C-12: 7을 내고 ◆ 선택, 다음 사람이 ◆3 / ♠7 / ♠3', () => {
    const s = mk({ hands: [['H7', 'C4'], ['D3', 'S7', 'S3'], ...other.slice(1)] });
    const after = ok(oneCard.playCard(s, 0, 'H7', 'D')).state;
    expect(after.chosenSuit).toBe('D');
    expect(oneCard.playCard(after, 1, 'D3', undefined).ok).toBe(true);
    expect(oneCard.playCard(after, 1, 'S7', 'H').ok).toBe(true);
    expect(oneCard.playCard(after, 1, 'S3', undefined)).toEqual({ ok: false, code: 'INVALID_CARD' });
  });

  it('CT-21 C-12: ◆를 고른 7 위에 ♠7을 내고 ♥를 고르면 다음은 ♥·7·조커만', () => {
    const s = mk({
      hands: [['C3', 'C4'], ['S7', 'S3'], ['H3', 'D3', 'C7', 'JC'], ['S9']],
      discard: ['H7'],
      chosenSuit: 'D',
      turn: 1,
    });
    const after = ok(oneCard.playCard(s, 1, 'S7', 'H')).state;
    expect(after.chosenSuit).toBe('H');
    expect(['H3', 'D3', 'C7', 'JC'].map((c) => oneCard.canPlayCard(after, c))).toEqual([
      true,
      false,
      true,
      true,
    ]);
  });

  it('CE-04: 7인데 모양이 없거나 잘못됨, 7이 아닌데 모양을 보냄 → INVALID_SUIT', () => {
    const s = mk({ hands: [['H7', 'H9'], ...other] });
    expect(oneCard.playCard(s, 0, 'H7', undefined)).toEqual({ ok: false, code: 'INVALID_SUIT' });
    expect(oneCard.playCard(s, 0, 'H7', 'X')).toEqual({ ok: false, code: 'INVALID_SUIT' });
    expect(oneCard.playCard(s, 0, 'H9', 'S')).toEqual({ ok: false, code: 'INVALID_SUIT' });
  });

  it('CT-08 C-14: 가져온 카드를 낼 수 있으면 그 카드만 바로 낼 수 있고, 넘기기도 된다', () => {
    const s = mk({ hands: [['C9', 'D9'], ...other], deck: ['H8', 'S3'] });
    const drawn = ok(oneCard.drawCards(s, 0, env)).state;
    expect(drawn.drawn).toBe('H8');
    expect(drawn.turn).toBe(0);
    expect(oneCard.playableCards(drawn, 0)).toEqual(['H8']);
    expect(oneCard.drawCards(drawn, 0, env)).toEqual({ ok: false, code: 'INVALID_STATE' });
    expect(ok(oneCard.playCard(drawn, 0, 'H8', undefined)).state.turn).toBe(1);
    expect(ok(oneCard.passTurn(drawn, 0)).state).toMatchObject({ turn: 1, drawn: null });
  });

  it('C-14: 가져온 카드를 낼 수 없으면 바로 차례가 끝난다, CE-05: 가져오기 전 넘기기는 INVALID_STATE', () => {
    const s = mk({ hands: [['C9'], ...other], deck: ['S3'] });
    expect(oneCard.passTurn(s, 0)).toEqual({ ok: false, code: 'INVALID_STATE' });
    expect(ok(oneCard.drawCards(s, 0, env)).state).toMatchObject({ turn: 1, drawn: null });
  });

  it('CT-11 C-15: 덱이 떨어지면 맨 위 1장만 남기고 버린 카드를 섞어 가져온다', () => {
    const s = mk({ hands: [['C9'], ...other], deck: [], discard: ['S3', 'S4', 'H5'] });
    const r = ok(oneCard.drawCards(s, 0, env));
    expect(r.events[0]).toEqual({ type: 'reshuffled', count: 2 });
    expect(r.state.discard).toEqual(['H5']);
    expect(r.state.hands[0]).toEqual(['C9', 'S3']);
    expect(r.state.deck).toEqual(['S4']);
  });
});

describe('공격 (C-20~C-22)', () => {
  it('CT-04: ♥2 공격에 ♠2로 받아치면 4장 누적, 다음 사람이 받아 먹으면 4장 가져오고 차례 끝', () => {
    let s = mk({ hands: [['H2', 'C3'], ['S2', 'C4'], ['D9', 'D8'], ['S9']] });
    s = ok(oneCard.playCard(s, 0, 'H2', undefined)).state;
    expect(s.attack).toBe(2);
    s = ok(oneCard.playCard(s, 1, 'S2', undefined)).state;
    expect(s.attack).toBe(4);
    const r = ok(oneCard.drawCards(s, 2, env));
    expect(r.state.hands[2]).toHaveLength(6);
    expect(r.state).toMatchObject({ attack: 0, turn: 3, drawn: null });
    expect(r.events).toContainEqual({
      type: 'drew',
      seat: 2,
      cards: ['S3', 'S4', 'S5', 'S6'],
      reason: 'attack',
    });
  });

  it('CT-05: ♥2 공격에 ♠A는 못 낸다 (모양도 숫자도 다름). ♥A, 조커는 된다', () => {
    const s = mk({ hands: [['SA', 'HA', 'JB', 'H9'], ...other], discard: ['H2'], attack: 2 });
    expect(['SA', 'HA', 'JB', 'H9'].map((c) => oneCard.canPlayCard(s, c))).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  it('CT-06: 흑백 조커 공격은 컬러 조커로만 (+12), 컬러 조커 공격은 받아칠 수 없다', () => {
    const s = mk({ hands: [['JC', 'H2'], ...other], discard: ['JB'], attack: 5 });
    expect(oneCard.playCard(s, 0, 'H2', undefined)).toEqual({ ok: false, code: 'INVALID_CARD' });
    expect(ok(oneCard.playCard(s, 0, 'JC', undefined)).state.attack).toBe(12);
    const top = mk({ hands: [['JB', 'HA'], ...other], discard: ['JC'], attack: 7 });
    expect(oneCard.playableCards(top, 0)).toEqual([]);
  });

  it('CT-07 C-22: 공격 중 가져오면 누적 장수만큼 받고, 받은 카드는 낼 수 없다', () => {
    const s = mk({ hands: [['C9'], ...other], discard: ['H2'], attack: 2, deck: ['H3', 'H4', 'S3'] });
    const r = ok(oneCard.drawCards(s, 0, env)).state;
    expect(r.hands[0]).toEqual(['C9', 'H3', 'H4']);
    expect(r).toMatchObject({ drawn: null, turn: 1, attack: 0 });
  });

  it('C-26: 공격 중에는 7을 낼 수 없다', () => {
    const s = mk({ hands: [['H7'], ...other], discard: ['H2'], attack: 2 });
    expect(oneCard.canPlayCard(s, 'H7')).toBe(false);
  });
});

describe('특수 카드 (C-23~C-25)', () => {
  it('CT-09 C-23: K를 내면 같은 사람이 한 번 더', () => {
    const s = mk({ hands: [['HK', 'C3'], ...other] });
    expect(ok(oneCard.playCard(s, 0, 'HK', undefined)).state.turn).toBe(0);
  });

  it('CT-10 C-24: 4인 J는 한 명 건너뛴다', () => {
    const s = mk({ hands: [['HJ', 'C3'], ...other] });
    expect(ok(oneCard.playCard(s, 0, 'HJ', undefined)).state.turn).toBe(2);
  });

  it('CT-10 C-25: 4인 Q는 방향이 바뀐다', () => {
    const s = mk({ hands: [['HQ', 'C3'], ...other] });
    const r = ok(oneCard.playCard(s, 0, 'HQ', undefined)).state;
    expect(r.direction).toBe(-1);
    expect(r.turn).toBe(3);
  });

  it('CT-10 C-25: 2인 Q, 2인 J는 내가 한 번 더', () => {
    const q = mk({ hands: [['HQ', 'C3'], ['D9']] });
    expect(ok(oneCard.playCard(q, 0, 'HQ', undefined)).state.turn).toBe(0);
    const j = mk({ hands: [['HJ', 'C3'], ['D9']] });
    expect(ok(oneCard.playCard(j, 0, 'HJ', undefined)).state.turn).toBe(0);
  });

  it('C-25: 4인 중 2명이 다 냈으면 Q는 J와 같다', () => {
    const s = mk({
      hands: [['HQ', 'C3'], [], ['D9'], []],
      status: ['playing', 'finished', 'playing', 'finished'],
      finishOrder: [1, 3],
    });
    expect(ok(oneCard.playCard(s, 0, 'HQ', undefined)).state.turn).toBe(0);
  });

  it('nextActive는 다 낸 사람과 파산한 사람을 건너뛴다', () => {
    const s = mk({ hands: [['H9'], [], [], ['S9']], status: ['playing', 'finished', 'bankrupt', 'playing'] });
    expect(oneCard.nextActive(s, 0)).toBe(3);
    expect(oneCard.nextActive(s, 3)).toBe(0);
  });
});

describe('원카드, 다 냄, 파산, 순위 (C-30~C-36)', () => {
  it('C-30: 내서 1장이 되면 one_card 이벤트', () => {
    const s = mk({ hands: [['H9', 'C3'], ...other] });
    expect(ok(oneCard.playCard(s, 0, 'H9', undefined)).events).toContainEqual({ type: 'one_card', seat: 0 });
  });

  it('CT-12 C-31: 원카드 벌칙은 차례와 상관없이 1장', () => {
    const s = mk({ hands: [['C3'], ...other], turn: 1 });
    const r = ok(oneCard.penaltyDraw(s, 0, env)).state;
    expect(r.hands[0]).toEqual(['C3', 'S3']);
    expect(r.turn).toBe(1);
  });

  it('CT-13 C-33: 마지막 카드가 공격 카드면 다 냄으로 순위가 정해지고 공격은 다음 사람에게', () => {
    const s = mk({ hands: [['H2'], ...other] });
    const r = ok(oneCard.playCard(s, 0, 'H2', undefined));
    expect(r.events).toContainEqual({ type: 'finished', seat: 0, rank: 1 });
    expect(r.state).toMatchObject({ attack: 2, turn: 1 });
    expect(r.state.status[0]).toBe('finished');
  });

  it('C-33: 마지막 카드가 K면 한 번 더 없이 끝나고 다음 사람 차례', () => {
    const s = mk({ hands: [['HK'], ...other] });
    expect(ok(oneCard.playCard(s, 0, 'HK', undefined)).state.turn).toBe(1);
  });

  it('CT-14 C-34: 공격을 받아 21장이 되면 파산, 패는 버린 더미 맨 아래로, 맨 위 카드와 차례는 그대로 진행', () => {
    const hand = Array.from({ length: 19 }, (_, i) => `C${['3', '4', '5', '6', '8', '9', '10'][i % 7]}`);
    const s = mk({
      hands: [hand, ['C9'], ['D9'], ['S9']],
      discard: ['H2'],
      attack: 2,
      deck: ['S3', 'S4', 'S5'],
    });
    const r = ok(oneCard.drawCards(s, 0, env));
    expect(r.events).toContainEqual({ type: 'bankrupt', seat: 0 });
    expect(r.state.status[0]).toBe('bankrupt');
    expect(r.state.hands[0]).toEqual([]);
    expect(oneCard.topCard(r.state)).toBe('H2');
    expect(r.state.discard).toHaveLength(22);
    expect(r.state).toMatchObject({ attack: 0, turn: 1 });
  });

  it('CT-15 C-36: 3인 중 2명이 다 내면 끝나고 1·2·3위가 확정된다', () => {
    let s = mk({ hands: [['H9'], ['H8'], ['C3', 'C4']] });
    s = ok(oneCard.playCard(s, 0, 'H9', undefined)).state;
    const r = ok(oneCard.playCard(s, 1, 'H8', undefined));
    expect(r.state.over).toBe(true);
    expect(r.events.at(-1)).toEqual({ type: 'game_over', ranking: [0, 1, 2] });
  });

  it('C-35: 파산한 사람은 다 낸 사람 뒤, 늦게 파산한 쪽이 위', () => {
    expect(oneCard.rankingOf({ finishOrder: [2, 0], bankruptOrder: [1, 3] })).toEqual([2, 0, 3, 1]);
  });

  it('끝난 판에서는 아무것도 할 수 없다', () => {
    const s = mk({ hands: [['H9'], ['C3']], over: true });
    expect(oneCard.playCard(s, 0, 'H9', undefined)).toEqual({ ok: false, code: 'INVALID_STATE' });
  });
});

describe('시간 초과와 봇 (C-51, C-56)', () => {
  it('CT-17 C-51: 공격 중이면 받아 먹고, 아니면 1장 가져와서 (낼 수 있어도) 넘긴다', () => {
    const attacked = mk({ hands: [['C9'], ...other], discard: ['H2'], attack: 2 });
    expect(ok(oneCard.autoAction(attacked, 0, env)).state).toMatchObject({ turn: 1, attack: 0 });
    const s = mk({ hands: [['C9'], ...other], deck: ['H8'] });
    const r = ok(oneCard.autoAction(s, 0, env)).state;
    expect(r.hands[0]).toEqual(['C9', 'H8']);
    expect(r).toMatchObject({ turn: 1, drawn: null });
  });

  it('C-56: 봇은 숫자 카드부터 내고 공격 카드와 조커는 아낀다', () => {
    const s = mk({ hands: [['JB', 'H2', 'HK', 'H9'], ...other] });
    expect(oneCard.oneCardBotAction(s, s.hands[0]!)).toEqual({ type: 'play', card: 'H9', suit: null });
  });

  it('C-56: 공격을 받으면 가장 약한 공격 카드로 받아치고, 없으면 가져온다', () => {
    const s = mk({ hands: [['JC', 'HA', 'C3'], ...other], discard: ['H2'], attack: 2 });
    expect(oneCard.oneCardBotAction(s, s.hands[0]!)).toEqual({ type: 'play', card: 'HA', suit: null });
    const none = mk({ hands: [['C3'], ...other], discard: ['H2'], attack: 2 });
    expect(oneCard.oneCardBotAction(none, none.hands[0]!)).toEqual({ type: 'draw' });
  });

  it('C-56: 7을 내면 남은 패에 가장 많은 모양을 고른다', () => {
    const s = mk({ hands: [['H7', 'C3', 'C4', 'S9'], ...other], discard: ['D5'] });
    expect(oneCard.oneCardBotAction({ ...s, discard: ['H5'] }, ['H7', 'C3', 'C4', 'S9'])).toEqual({
      type: 'play',
      card: 'H7',
      suit: 'C',
    });
  });

  it('C-56: 가져온 카드를 낼 수 있으면 내고, 아니면 넘긴다', () => {
    const s = mk({ hands: [['C9', 'H8'], ...other], drawn: 'H8' });
    expect(oneCard.oneCardBotAction(s, s.hands[0]!)).toEqual({ type: 'play', card: 'H8', suit: null });
    const cant = mk({ hands: [['C9', 'C8'], ...other], drawn: 'C8' });
    expect(oneCard.oneCardBotAction(cant, cant.hands[0]!)).toEqual({ type: 'pass' });
  });

  it('봇끼리 1,000판을 두면 모두 끝나고 카드 54장이 보존된다', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const shuffle = (cards: readonly string[]) => {
      const a = [...cards];
      for (let i = a.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j] as string, a[i] as string];
      }
      return a;
    };
    for (let game = 0; game < 1000; game += 1) {
      const seats = 2 + (game % 5);
      let s = oneCard.startOneCard(shuffle(oneCard.fullDeck()), seats, game % seats);
      let steps = 0;
      while (!s.over) {
        steps += 1;
        if (steps > 5000) throw new Error(`game ${game} did not end`);
        const a = oneCard.oneCardBotAction(s, s.hands[s.turn]!);
        const r =
          a.type === 'play'
            ? oneCard.playCard(s, s.turn, a.card, a.suit ?? undefined)
            : a.type === 'draw'
              ? oneCard.drawCards(s, s.turn, { shuffle })
              : oneCard.passTurn(s, s.turn);
        s = ok(r).state;
        const total = s.deck.length + s.discard.length + s.hands.reduce((n, h) => n + h.length, 0);
        expect(total).toBe(54);
      }
      expect(oneCard.rankingOf(s)).toHaveLength(seats);
    }
  });
});

describe('원카드 방 옵션과 표시 (7장)', () => {
  it('기본값: 최대 4명, 30초, 봇 채우기, 비공개', () => {
    expect(oneCard.parseOneCardOptions(undefined)).toEqual({
      ok: true,
      options: oneCard.DEFAULT_ONE_CARD_OPTIONS,
    });
    expect(oneCard.DEFAULT_ONE_CARD_OPTIONS).toEqual({
      maxPlayers: 4,
      turnSeconds: 30,
      fillWithBots: true,
      isPrivate: true,
    });
  });

  it('범위 안의 값은 덮어쓰고, 모르는 키는 무시한다', () => {
    const r = oneCard.parseOneCardOptions({
      maxPlayers: 6,
      turnSeconds: 15,
      fillWithBots: false,
      isPrivate: false,
      x: 1,
    });
    expect(r).toEqual({
      ok: true,
      options: { maxPlayers: 6, turnSeconds: 15, fillWithBots: false, isPrivate: false },
    });
  });

  it('범위 밖이면 전체를 거부한다', () => {
    for (const [input, field] of [
      [{ maxPlayers: 1 }, 'maxPlayers'],
      [{ maxPlayers: 7 }, 'maxPlayers'],
      [{ maxPlayers: 2.5 }, 'maxPlayers'],
      [{ turnSeconds: 20 }, 'turnSeconds'],
      [{ fillWithBots: 'yes' }, 'fillWithBots'],
      [[1], 'input'],
      ['x', 'input'],
    ] as const)
      expect(oneCard.parseOneCardOptions(input)).toEqual({ ok: false, code: 'INVALID_OPTIONS', field });
  });

  it('카드 이름: ♠7, ♥10, 흑백 조커, 컬러 조커', () => {
    expect(['S7', 'H10', 'JB', 'JC'].map(oneCard.cardLabel)).toEqual(['♠7', '♥10', '흑백 조커', '컬러 조커']);
  });

  it('isCard는 문자열이 아닌 값을 거부한다', () => {
    expect([7, null, undefined, {}, ''].some(oneCard.isCard)).toBe(false);
  });
});
