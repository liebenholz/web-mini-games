import { h } from '../../dom.js';

/** 도둑잡기 규칙 시트 내용 (docs/specs/thief.md). 규칙 ID는 data-spec에 남긴다 */
export const THIEF_RULE_STEPS = [
  {
    title: '카드를 나누고 짝을 내려놓아요',
    body: '카드 52장과 조커 1장을 모두 나눠요. 숫자가 같은 카드 두 장은 짝이라서 자동으로 내려가요. 조커는 짝이 없어요.',
    spec: ['TF-01', 'TF-02', 'TF-03'],
  },
  {
    title: '다음 사람의 패에서 한 장 뽑아요',
    body: '내 차례에 다음 사람의 패(뒷면)에서 한 장을 골라 가져와요. 뽑은 카드가 내 패와 숫자가 같으면 두 장이 내려가요. 뽑은 카드는 나만 알아요. 카드가 오갈 때마다 패는 섞여서 위치로는 알 수 없어요.',
    spec: ['TF-05', 'TF-06', 'TF-07'],
  },
  {
    title: '패를 다 내려놓으면 안전해요',
    body: '패가 0장이 되면 안전하고 빠져요. 마지막 한 장을 빼앗겨서 0장이 되어도 안전해요.',
    spec: ['TF-08', 'TF-09'],
  },
  {
    title: '조커를 끝까지 든 사람이 당첨',
    body: '패가 남은 사람이 한 명이 되면 끝나요. 그 사람이 조커를 들고 있어서 당첨이에요.',
    spec: ['TF-10', 'TF-11'],
  },
  {
    title: '시간이 지나면 대신 뽑아요',
    body: '시간 안에 못 뽑으면 무작위 한 장을 대신 뽑아요. 두 번 연속이면 봇이 이어서 하고, 직접 뽑으면 돌려받아요.',
    spec: ['TF-12'],
  },
] as const;

export function thiefRules(): HTMLElement {
  const list = h('ol', { class: 'rules-steps' });
  THIEF_RULE_STEPS.forEach((step, i) => {
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
    h('p', { class: 'rules-intro' }, '조커를 피해 짝을 맞추다가, 마지막까지 조커를 든 한 명이 당첨돼요.'),
    list,
    h(
      'p',
      { class: 'rules-tip' },
      h('b', {}, '팁 '),
      '내려놓은 짝을 보면 남은 카드를 짐작할 수 있어요. 조커는 표정을 숨기는 사람의 패에 있을지도 몰라요.',
    ),
  );
}
