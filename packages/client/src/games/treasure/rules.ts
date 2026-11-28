import { h } from '../../dom.js';

/** 보물 찾기 규칙 시트 내용 (docs/specs/treasure.md). 규칙 ID는 data-spec에 남긴다 */
export const TREASURE_RULE_STEPS = [
  {
    title: '보물이 9×9 판 어딘가에 숨어 있어요',
    body: '보물 위치는 아무도 몰라요. 모두 같은 판에서 한 칸씩 골라요.',
    spec: ['BH-01'],
  },
  {
    title: '모두 동시에 몰래 골라요',
    body: '칸을 누르면 선택돼요. 마감 전에는 다른 칸으로 바꿀 수 있고, "확정"을 누르면 잠겨요. 서로 어디를 골랐는지는 공개 전까지 안 보여요. 모두 확정하면 바로 공개해요.',
    spec: ['BH-02', 'BH-03', 'BH-04'],
  },
  {
    title: '보물에서 가장 먼 사람이 당첨',
    body: '보물과 가장 멀리 고른 한 명이 당첨이에요. 거리는 칸 사이의 직선거리예요.',
    spec: ['BH-05', 'BH-06'],
  },
  {
    title: '같은 거리면 다시 골라요',
    body: '가장 먼 사람이 둘 이상이면 그 사람들끼리 새 보물로 다시 골라요. 한 명이 가려질 때까지 반복하고, 5번 해도 같으면 무작위로 한 명이 정해져요.',
    spec: ['BH-07'],
  },
  {
    title: '시간이 지나면 대신 골라요',
    body: '시간 안에 확정하지 않으면, 골라 둔 칸은 그대로 확정되고 못 골랐으면 무작위 칸을 대신 골라요. 못 골라서 대신 고른 일이 두 번 연속이면 봇이 이어서 해요. 직접 고르면 돌려받아요.',
    spec: ['BH-11', 'BH-12'],
  },
] as const;

export function treasureRules(): HTMLElement {
  const list = h('ol', { class: 'rules-steps' });
  TREASURE_RULE_STEPS.forEach((step, i) => {
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
    h('p', { class: 'rules-intro' }, '보물에서 가장 멀리 고른 한 명이 당첨돼요.'),
    list,
    h(
      'p',
      { class: 'rules-tip' },
      h('b', {}, '팁 '),
      '모서리는 보물이 가운데 근처일수록 멀어서 위험해요. 어디가 보물일지 남들이 어디를 고를지 같이 생각해 보세요.',
    ),
  );
}
