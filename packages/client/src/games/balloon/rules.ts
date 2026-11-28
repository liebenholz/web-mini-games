import { h } from '../../dom.js';

/** 풍선 터뜨리기 규칙 시트 내용 (docs/specs/balloon.md). 규칙 ID는 data-spec에 남긴다 */
export const BALLOON_RULE_STEPS = [
  {
    title: '풍선이 언제 터질지 몰라요',
    body: '풍선은 정해진 횟수(인원에 따라 5번부터 인원 × 4 + 12번 사이)에서 터져요. 정확한 횟수는 아무도 몰라요. 화면에는 지금까지 분 횟수와 터질 수 있는 범위만 보여요.',
    spec: ['BL-01'],
  },
  {
    title: '차례마다 1~3번 불어요',
    body: '내 차례에 바람 넣기를 한 번씩 눌러요. 한 번 이상 불었으면 넘기기를 누를 수 있고, 3번째를 불면 자동으로 다음 사람에게 넘어가요.',
    spec: ['BL-02', 'BL-03', 'BL-04', 'BL-05'],
  },
  {
    title: '터뜨린 사람이 당첨',
    body: '풍선이 터지는 순간 바람을 넣은 사람이 당첨되고 바로 끝나요.',
    spec: ['BL-06'],
  },
  {
    title: '시간이 지나면 대신 불어요',
    body: '시간 안에 한 번도 안 불었으면 1~3번을 무작위로 대신 불어요. 두 번 연속이면 봇이 이어서 하고, 직접 누르면 다시 돌려받아요. 이미 불었다면 그냥 넘어가요.',
    spec: ['BL-11', 'BL-12'],
  },
] as const;

export function balloonRules(): HTMLElement {
  const list = h('ol', { class: 'rules-steps' });
  BALLOON_RULE_STEPS.forEach((step, i) => {
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
    h('p', { class: 'rules-intro' }, '풍선에 바람을 불어 넣다가, 터뜨린 한 명이 당첨돼요.'),
    list,
    h(
      'p',
      { class: 'rules-tip' },
      h('b', {}, '팁 '),
      '풍선이 클수록 곧 터질 것 같지만 언제 터질지는 아무도 몰라요. 한 번만 불고 넘길지, 3번 다 불지는 눈치 싸움이에요.',
    ),
  );
}
