import { h } from '../../dom.js';

/** 오목 규칙 시트 내용 (docs/specs/gomoku.md). 규칙 ID는 data-spec에 남긴다 */
export const GOMOKU_RULE_STEPS = [
  {
    title: '흑이 먼저 둬요',
    body: '흑과 백이 번갈아 빈 교차점에 돌을 하나씩 둬요. 누가 흑을 할지는 방장이 정해요.',
    spec: ['G-02', 'G-03'],
  },
  {
    title: '다섯을 먼저 이으면 이겨요',
    body: '가로, 세로, 대각선 중 한 줄로 내 돌 다섯 개를 이으면 이겨요. 백은 여섯 개 이상이어도 이겨요.',
    spec: ['G-04', 'G-05'],
  },
  {
    title: '흑에게만 금수가 있어요',
    body: '방 설정에 따라 흑은 3-3(열린 3 두 개), 4-4(4 두 개), 장목(여섯 이상)이 되는 자리에 둘 수 없어요. 판에 빨간 X로 보여요. 정확히 다섯이 되는 수는 언제나 둘 수 있어요.',
    spec: ['G-06', 'G-07', 'G-08', 'G-09', 'G-10'],
  },
  {
    title: '시간 안에 두지 않으면 져요',
    body: '한 수마다 제한 시간이 있어요(방 설정). 시간이 지나면 시간패예요. 연결이 끊겨도 시간은 흘러요.',
    spec: ['G-12', 'G-21', 'G-23'],
  },
  {
    title: '나가면 봇이 이어서 둬요',
    body: '대국 중에 나가면 봇이 그 자리를 이어서 두고, 상대에게 알려 줘요. 판이 다 차면 무승부예요.',
    spec: ['G-11', 'G-22'],
  },
  {
    title: '두는 법',
    body: 'PC: 마우스를 올리면 반투명 돌이 보이고, 클릭하면 둬요. 폰: 한 번 누르면 미리 보이고, 같은 자리를 한 번 더 누르면 둬요. 방향키와 Enter로도 둘 수 있어요.',
    spec: ['G-30', 'G-31', 'G-33'],
  },
] as const;

export function gomokuRules(): HTMLElement {
  const list = h('ol', { class: 'rules-steps' });
  GOMOKU_RULE_STEPS.forEach((step, i) => {
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
    h('p', { class: 'rules-intro' }, '15×15 판에서 내 돌 다섯 개를 먼저 한 줄로 이으면 이겨요.'),
    list,
    h(
      'p',
      { class: 'rules-tip' },
      h('b', {}, '팁 '),
      '상대의 열린 3(양쪽이 비어 있는 세 개)은 바로 막아야 해요. 그대로 두면 열린 4가 되어 막을 수 없어요.',
    ),
  );
}
