import { h } from '../../dom.js';
import { cardFace } from './cards.js';

/** 원카드 규칙 시트 내용 (docs/specs/one-card.md, 시안). 규칙 ID는 data-spec에 남긴다 */
export const ONE_CARD_RULE_STEPS = [
  {
    title: '같은 모양이나 같은 숫자를 내요',
    body: '맨 위 카드와 모양이 같거나 숫자가 같은 카드를 한 장 내요. 조커는 언제나 낼 수 있어요.',
    spec: ['C-10', 'C-11'],
  },
  {
    title: '낼 카드가 없으면 1장 가져와요',
    body: '덱에서 1장을 가져와요. 가져온 카드를 낼 수 있으면 그 차례에 바로 낼 수 있어요. 내지 않으면 차례가 넘어가요.',
    spec: ['C-14', 'C-15'],
  },
  {
    title: '공격 카드로 떠넘겨요',
    body: '공격 카드를 내면 다음 사람이 카드를 가져와야 해요. 받은 사람은 공격 카드로 받아쳐 다음 사람에게 넘길 수 있고, 장수는 쌓여요. 받아치지 못하면 쌓인 장수를 모두 가져오고 차례가 끝나요.',
    spec: ['C-20', 'C-21', 'C-22'],
  },
  {
    title: '특수 카드',
    body: '',
    spec: ['C-23', 'C-24', 'C-25', 'C-26'],
  },
  {
    title: '1장 남으면 원카드!',
    body: '카드를 내서 1장이 남으면 화면에 원카드 버튼이 떠요. 3초 안에 본인이 먼저 누르면 안전하고, 다른 사람이 먼저 누르면 1장을 더 가져와요. 판정이 끝날 때까지 게임은 잠깐 멈춰요.',
    spec: ['C-30', 'C-31', 'C-32'],
  },
  {
    title: '20장을 넘으면 파산',
    body: '카드가 20장을 넘으면 그 판에서 탈락해요. 순위는 다 낸 사람들 뒤로 가요.',
    spec: ['C-34'],
  },
  {
    title: '끝까지 순위를 매겨요',
    body: '먼저 다 낸 사람이 1위예요. 한 명만 남을 때까지 계속해서 2위, 3위를 정해요.',
    spec: ['C-33', 'C-35', 'C-36'],
  },
  {
    title: '시간과 퇴장',
    body: '차례마다 제한 시간이 있어요(방 설정). 시간이 지나면 자동으로 1장을 가져와요(공격 중이면 쌓인 장수를 가져와요). 두 번 연속이면 봇이 대신 두고, 다시 직접 두면 돌려받아요. 게임 중에 나가면 봇이 이어서 해요.',
    spec: ['C-51', 'C-52', 'C-55'],
  },
] as const;

function table(rows: readonly (readonly [string, string])[]): HTMLElement {
  return h(
    'table',
    { class: 'rules-table' },
    h('tbody', {}, ...rows.map(([k, v]) => h('tr', {}, h('th', { scope: 'row' }, k), h('td', {}, v)))),
  );
}

function chips(kind: 'atk' | 'sp', items: readonly string[]): HTMLElement {
  return h(
    'div',
    { class: 'rules-chips' },
    ...items.map((t) => h('span', { class: `rules-chip ${kind}` }, t)),
  );
}

/** 단계별 그림과 표 (시안) */
function extra(index: number): HTMLElement | null {
  if (index === 0)
    return h(
      'div',
      { class: 'rules-example' },
      h('div', { class: 'rules-cards' }, '맨 위', cardFace('H5', 'mini'), '일 때'),
      h(
        'div',
        { class: 'rules-cards' },
        cardFace('H9', 'mini'),
        h('span', { class: 'ok' }, '○ 같은 모양'),
        cardFace('S5', 'mini'),
        h('span', { class: 'ok' }, '○ 같은 숫자'),
        cardFace('S9', 'mini'),
        h('span', { class: 'no' }, '✕'),
      ),
    );
  if (index === 2)
    return h(
      'div',
      {},
      chips('atk', ['2 +2장', 'A +3장', '흑백 조커 +5장', '컬러 조커 +7장']),
      table([
        ['2, A 공격', '모양이나 숫자가 같은 2·A, 또는 조커로 받아쳐요'],
        ['흑백 조커', '컬러 조커로만 받아쳐요'],
        ['컬러 조커', '받아칠 수 없어요'],
      ]),
    );
  if (index === 3)
    return h(
      'div',
      {},
      chips('sp', ['7 모양 바꾸기', 'J 건너뛰기', 'Q 방향 바꾸기', 'K 한 번 더']),
      table([
        ['7', '다음 사람이 낼 모양을 골라요. 그 위에 다른 7을 내면 다시 골라요'],
        ['J', '다음 사람을 건너뛰어요'],
        ['Q', '순서가 반대로 돌아요. 2명일 때는 내가 한 번 더 내요'],
        ['K', '내가 한 번 더 내요'],
      ]),
    );
  return null;
}

export function oneCardRules(): HTMLElement {
  const list = h('ol', { class: 'rules-steps' });
  ONE_CARD_RULE_STEPS.forEach((step, i) => {
    list.append(
      h(
        'li',
        { 'data-spec': step.spec.join(' ') },
        h('h3', {}, h('span', { class: 'rules-num', 'aria-hidden': 'true' }, String(i + 1)), step.title),
        step.body ? h('p', {}, step.body) : null,
        extra(i),
      ),
    );
  });
  return h(
    'div',
    { class: 'rules-body' },
    h(
      'p',
      { class: 'rules-intro' },
      '맨 위 카드와 모양이나 숫자가 같은 카드를 한 장씩 내요. 패를 먼저 다 내면 이겨요.',
    ),
    list,
    h(
      'p',
      { class: 'rules-tip' },
      h('b', {}, '팁 '),
      '공격 카드와 조커는 아껴 두었다가 공격을 받아칠 때 쓰세요. 1장이 남으면 원카드 버튼부터 누르세요.',
    ),
  );
}
