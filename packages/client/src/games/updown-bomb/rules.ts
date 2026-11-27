import { h } from '../../dom.js';

/** 업다운 숫자폭탄 규칙 시트 내용 (docs/specs/updown-bomb.md). 규칙 ID는 data-spec에 남긴다 */
export const UPDOWN_RULE_STEPS = [
  {
    title: '폭탄 숫자가 숨어 있어요',
    body: '1~100(방 설정) 사이에 폭탄 숫자 하나가 숨어 있어요. 아무도 몰라요.',
    spec: ['UD-01'],
  },
  {
    title: '차례대로 숫자를 말해요',
    body: '지금 범위 안의 숫자 하나를 말해요. 폭탄보다 작으면 "업", 크면 "다운"이 나오고 범위가 좁혀져요.',
    spec: ['UD-02', 'UD-03', 'UD-04', 'UD-05'],
  },
  {
    title: '폭탄을 말하면 당첨',
    body: '폭탄 숫자를 말한 사람이 당첨되고 바로 끝나요. 남은 숫자가 폭탄 하나뿐이면 그 차례인 사람이 당첨이에요.',
    spec: ['UD-06', 'UD-07'],
  },
  {
    title: '시간이 지나면 대신 말해요',
    body: '시간 안에 말하지 않으면 범위 안의 숫자를 무작위로 대신 말해요. 두 번 연속이면 봇이 이어서 하고, 직접 말하면 다시 돌려받아요.',
    spec: ['UD-11', 'UD-12'],
  },
] as const;

export function updownRules(): HTMLElement {
  const list = h('ol', { class: 'rules-steps' });
  UPDOWN_RULE_STEPS.forEach((step, i) => {
    list.append(
      h(
        'li',
        { 'data-spec': step.spec.join(' ') },
        h('h3', {}, h('span', { class: 'rules-num', 'aria-hidden': 'true' }, String(i + 1)), step.title),
        h('p', {}, step.body),
      ),
    );
  });
  return h(
    'div',
    { class: 'rules-body' },
    h('p', { class: 'rules-intro' }, '범위를 좁혀 가며 숫자를 말하다, 폭탄 숫자를 말한 한 명이 당첨돼요.'),
    list,
    h(
      'p',
      { class: 'rules-tip' },
      h('b', {}, '팁 '),
      '어느 숫자를 말해도 그 차례에 당첨될 확률은 같아요. 대신 범위를 얼마나 남기느냐에 따라 다음 사람이 곤란해져요.',
    ),
  );
}
