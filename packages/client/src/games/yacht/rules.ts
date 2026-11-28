import { h } from '../../dom.js';

/** 요트 주사위 규칙 시트 내용 (docs/specs/yacht.md). 규칙 ID는 data-spec에 남긴다 */
export const YACHT_RULE_STEPS = [
  {
    title: '한 차례에 최대 3번 굴려요',
    body: '처음에는 주사위 5개를 모두 굴려요. 다음부터는 남기고 싶은 주사위를 눌러 고정하고 나머지만 다시 굴려요. 한 번이라도 굴렸으면 3번을 다 쓰지 않아도 기록할 수 있어요.',
    spec: ['YT-02', 'YT-03', 'YT-04'],
  },
  {
    title: '12칸 중 빈칸 하나에 기록해요',
    body: '1~6의 눈은 그 눈의 합, 초이스는 모두의 합이에요. 포카드(같은 눈 4개 이상)와 풀하우스(3개 + 2개)는 모두의 합, 스몰 스트레이트(4개 연속)는 15점, 라지 스트레이트(5개 연속)는 30점, 요트(5개 모두 같은 눈)는 50점이에요. 조건이 안 맞으면 0점으로 기록돼요.',
    spec: ['YT-05', 'YT-06'],
  },
  {
    title: '위쪽 합이 63 이상이면 +35점',
    body: '1~6의 눈 여섯 칸의 합이 63 이상이면 보너스 35점을 받아요.',
    spec: ['YT-07'],
  },
  {
    title: '12차례가 끝나면 합계로 순위를 매겨요',
    body: '모든 칸을 다 채우면 끝나요. 합계가 높은 사람이 위예요. 점수가 같으면 공동 순위예요.',
    spec: ['YT-08'],
  },
  {
    title: '시간이 지나면 대신 기록해요',
    body: '시간 안에 기록하지 못하면 한 번 굴리고(안 굴렸다면) 점수가 가장 높은 빈칸에 대신 기록해요. 두 번 연속이면 봇이 이어서 하고, 직접 누르면 돌려받아요.',
    spec: ['YT-10', 'YT-12'],
  },
] as const;

export function yachtRules(): HTMLElement {
  const list = h('ol', { class: 'rules-steps' });
  YACHT_RULE_STEPS.forEach((step, i) => {
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
    h('p', { class: 'rules-intro' }, '주사위 5개를 굴려 12개의 칸을 채우고, 합계가 가장 높은 사람이 이겨요.'),
    list,
    h(
      'p',
      { class: 'rules-tip' },
      h('b', {}, '팁 '),
      '처음 굴린 뒤 가장 많이 나온 눈을 남기면 포카드나 요트를 노릴 수 있어요. 안 맞는 칸에는 0점을 버리듯 기록해도 돼요.',
    ),
  );
}
