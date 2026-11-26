import { h } from '../../dom.js';

/** 리버시 규칙 시트 내용 (docs/specs/reversi.md). 규칙 ID는 data-spec에 남긴다 */
export const REVERSI_RULE_STEPS = [
  {
    title: '흑이 먼저 둬요',
    body: '가운데 네 칸에 흑백 두 개씩 놓고 시작해요. 흑과 백이 번갈아 한 수씩 둬요. 누가 흑을 할지는 방장이 정해요.',
    spec: ['RV-01', 'RV-02'],
  },
  {
    title: '끼우면 뒤집혀요',
    body: '내 돌 두 개 사이에 상대 돌을 가로, 세로, 대각선으로 끼우면 그 돌이 모두 내 색으로 바뀌어요. 한 수로 여러 방향을 한꺼번에 뒤집을 수도 있어요.',
    spec: ['RV-03'],
  },
  {
    title: '뒤집을 수 있는 칸에만 둬요',
    body: '하나라도 뒤집을 수 있는 칸에만 둘 수 있어요. 내 차례에는 그런 칸에 점이 보여요. 둘 곳이 없으면 자동으로 차례가 넘어가요.',
    spec: ['RV-04', 'RV-05'],
  },
  {
    title: '돌이 많은 쪽이 이겨요',
    body: '둘 다 둘 곳이 없으면 끝나요. 돌이 더 많은 쪽이 이기고, 같으면 무승부예요.',
    spec: ['RV-06', 'RV-07'],
  },
  {
    title: '시간이 지나면 대신 둬요',
    body: '한 수마다 제한 시간이 있어요(방 설정). 시간이 지나면 둘 수 있는 자리 중 하나에 대신 두고, 두 번 연속이면 봇이 이어서 둬요. 직접 두면 다시 돌려받아요. 대국 중에 나가도 봇이 이어서 둬요.',
    spec: ['RV-11', 'RV-12'],
  },
  {
    title: '두는 법',
    body: '폰: 점을 한 번 누르면 바로 둬요. PC: 점에 마우스를 올리면 뒤집힐 돌이 보이고, 클릭하면 둬요. 방향키와 Enter로도 둘 수 있어요.',
    spec: ['6장'],
  },
] as const;

export function reversiRules(): HTMLElement {
  const list = h('ol', { class: 'rules-steps' });
  REVERSI_RULE_STEPS.forEach((step, i) => {
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
    h('p', { class: 'rules-intro' }, '8×8 판에서 상대 돌을 끼워 뒤집고, 끝났을 때 돌이 더 많으면 이겨요.'),
    list,
    h(
      'p',
      { class: 'rules-tip' },
      h('b', {}, '팁 '),
      '네 모서리는 한 번 잡으면 다시 뒤집히지 않아요. 모서리 바로 옆 칸은 상대에게 모서리를 내줄 수 있으니 조심하세요.',
    ),
  );
}
