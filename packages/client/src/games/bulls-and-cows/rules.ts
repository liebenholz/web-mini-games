import { bulls } from '@wmg/rules';
import { h } from '../../dom.js';

/** 숫자야구 규칙 시트 내용 (docs/specs/bulls-and-cows.md). 규칙 ID는 data-spec에 남긴다 */
export const BULLS_RULE_STEPS = [
  {
    title: '비밀 숫자를 정해요',
    body: '0~9 숫자를 겹치지 않게 3개(또는 4개) 골라 내 비밀 숫자를 정해요. 맨 앞에 0도 돼요. 60초 안에 못 정하면 무작위로 정해져요.',
    spec: ['B-01', 'B-30'],
  },
  {
    title: '번갈아 상대 숫자를 추측해요',
    body: '선공은 무작위로 정해요. 자기 차례에 상대 숫자라고 생각하는 숫자를 내면, 숫자와 자리가 모두 맞은 개수와 숫자만 맞은 개수를 알려 줘요.',
    spec: ['B-02', 'B-03', 'B-06'],
  },
  {
    title: '결과 읽는 법',
    body: '',
    spec: ['B-11'],
  },
  {
    title: '먼저 맞히면 이겨요',
    body: '상대 숫자를 정확히 맞히면 이겨요. 선공이 먼저 맞히면 후공에게 같은 횟수가 되도록 마지막 기회를 한 번 줘요. 후공도 맞히면 무승부예요.',
    spec: ['B-05', 'B-07'],
  },
  {
    title: '시도 제한과 시간',
    body: '방 설정에 따라 시도 횟수에 제한이 있어요. 둘 다 끝까지 못 맞히면 무승부예요. 차례마다 제한 시간이 있고, 시간이 지나면 그 턴을 넘겨요(시도 1회). 두 번 연속이면 봇이 대신 추측해요.',
    spec: ['B-08', 'B-09', 'B-31', 'B-32'],
  },
  {
    title: '메모판을 써 보세요',
    body: '0~9 숫자를 누를 때마다 ? → 없음 → 있음으로 표시돼요. 내 화면에만 있어서 상대는 볼 수 없어요.',
    spec: ['8장'],
  },
] as const;

function notation(): HTMLElement {
  const row = (secret: string, guess: string, digits: bulls.Digits, why: string) =>
    h(
      'tr',
      {},
      h('th', { scope: 'row' }, guess),
      h('td', {}, h('b', {}, bulls.formatScore(bulls.score(secret, guess), digits))),
      h('td', {}, why),
    );
  return h(
    'div',
    {},
    h(
      'p',
      {},
      '3자리는 스트라이크 S, 볼 B로 쓰고 0은 생략해요. 하나도 없으면 OUT이에요. 상대 숫자가 102일 때:',
    ),
    h(
      'table',
      { class: 'rules-table' },
      h(
        'tbody',
        {},
        row('102', '345', 3, '1, 0, 2가 하나도 없음'),
        row('102', '120', 3, '1은 자리까지, 2와 0은 숫자만'),
        row('102', '152', 3, '1과 2는 자리까지'),
        row('102', '102', 3, '맞힘'),
      ),
    ),
    h('p', { class: 'rules-gap' }, '4자리는 Bull B, Cow C로 쓰고 0도 적어요. 상대 숫자가 0123일 때:'),
    h(
      'table',
      { class: 'rules-table' },
      h(
        'tbody',
        {},
        row('0123', '3210', 4, '네 숫자 모두 자리만 다름'),
        row('0123', '4567', 4, '하나도 없음'),
        row('0123', '0123', 4, '맞힘'),
      ),
    ),
  );
}

export function bullsRules(): HTMLElement {
  const list = h('ol', { class: 'rules-steps' });
  BULLS_RULE_STEPS.forEach((step, i) => {
    list.append(
      h(
        'li',
        { 'data-spec': step.spec.join(' ') },
        h('h3', {}, h('span', { class: 'rules-num', 'aria-hidden': 'true' }, String(i + 1)), step.title),
        step.body ? h('p', {}, step.body) : null,
        i === 2 ? notation() : null,
      ),
    );
  });
  return h(
    'div',
    { class: 'rules-body' },
    h(
      'p',
      { class: 'rules-intro' },
      '2명이 각자 비밀 숫자를 정하고, 스트라이크와 볼을 단서로 상대 숫자를 먼저 맞혀요.',
    ),
    list,
    h(
      'p',
      { class: 'rules-tip' },
      h('b', {}, '팁 '),
      'OUT이 나온 숫자 세 개는 메모판에서 모두 "없음"으로 지워 두면 후보가 확 줄어요.',
    ),
  );
}
