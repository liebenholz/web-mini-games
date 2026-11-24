import { DEFAULT_ROOM_OPTIONS } from '@wmg/rules';
import { h, svg } from '../../dom.js';
import { dieSvg } from '../../icons.js';

/** 규칙 한 단락. 문구는 명세(docs/specs/liars-dice.md)의 규칙 ID와 맞춘다 */
export interface RuleStep {
  readonly title: string;
  readonly body: string;
  /** 추적용 명세 ID (화면에는 보이지 않는다) */
  readonly spec: readonly string[];
}

/** 공개 예시: "4가 3개" 선언에 4와 1을 함께 센다 (R-09) */
export const WILD_EXAMPLE = { bid: { quantity: 3, face: 4 }, dice: [4, 1, 2, 4, 6, 1] } as const;

export const RULES_INTRO = '마지막까지 주사위가 남은 1명이 이겨요. 라운드마다 누군가 주사위 1개를 잃어요.';

export const RULE_STEPS: readonly RuleStep[] = [
  {
    title: '각자 주사위를 굴려요',
    body: '모두 동시에 굴리고, 내 주사위만 볼 수 있어요.',
    spec: ['R-01', 'S-01'],
  },
  {
    title: '판 전체에 몇 개 있는지 선언해요',
    body: '"4가 3개 이상"처럼 모두의 주사위를 합친 개수를 불러요. 눈은 2~6만 부를 수 있어요.',
    spec: ['R-05', 'R-06'],
  },
  {
    title: '더 높게 부르거나 라이어',
    body: '다음 사람은 개수를 늘리거나(눈은 자유), 같은 개수면 더 큰 눈을 불러요. 직전 선언을 못 믿겠으면 "라이어!"',
    spec: ['R-07', 'R-08', 'R-11'],
  },
  {
    title: '공개하고 세어요 · 1은 와일드',
    body: '모든 주사위를 공개해 선언한 눈을 세요. 1은 어떤 눈으로도 함께 세요.',
    spec: ['R-09'],
  },
  {
    title: '판정',
    body: '실제 개수가 선언 이상이면 라이어를 외친 사람이, 모자라면 선언한 사람이 주사위 1개를 잃어요.',
    spec: ['R-10'],
  },
  {
    title: '다음 라운드',
    body: '주사위를 잃은 사람이 먼저 선언해요. 주사위가 0개가 되면 탈락하고 관전해요.',
    spec: ['R-04', 'R-12', 'R-13'],
  },
  {
    title: '시간 제한',
    body: `한 턴은 ${DEFAULT_ROOM_OPTIONS.turnSeconds}초예요(방 옵션). 시간이 지나면 가장 낮은 선언이 자동으로 나가고, 2번 연속이면 직접 누를 때까지 자동으로 진행돼요.`,
    spec: ['S-06', 'S-07'],
  },
];

export const RULES_TIP =
  '모르는 주사위 하나가 특정 눈(1 포함)일 확률은 1/3이에요. 남의 주사위 수 ÷ 3을 어림잡아 보세요.';

function wildExample(): HTMLElement {
  const { bid, dice } = WILD_EXAMPLE;
  const row = h('div', {
    class: 'rules-dice',
    role: 'img',
    'aria-label': `공개된 주사위 ${dice.join(', ')}`,
  });
  for (const face of dice) {
    const hit = face === bid.face || face === 1;
    row.append(h('span', { class: `rules-die${hit ? ' hit' : ''}` }, svg(dieSvg(face))));
  }
  const count = dice.filter((f) => f === bid.face || f === 1).length;
  return h(
    'div',
    { class: 'rules-example' },
    row,
    h('p', {}, `"${bid.face}가 ${bid.quantity}개"면 ${bid.face}와 1을 함께 세서 ${count}개 → 선언 성공`),
  );
}

/** 거짓말쟁이 주사위 규칙 본문 (규칙 시트 안에서 위아래로 스크롤된다) */
export function liarsDiceRules(): HTMLElement {
  const list = h('ol', { class: 'rules-steps' });
  RULE_STEPS.forEach((step, i) => {
    list.append(
      h(
        'li',
        { 'data-spec': step.spec.join(' ') },
        h('h3', {}, h('span', { class: 'rules-num', 'aria-hidden': 'true' }, String(i + 1)), step.title),
        h('p', {}, step.body),
        step.spec.includes('R-09') ? wildExample() : null,
      ),
    );
  });
  return h(
    'div',
    { class: 'rules-body' },
    h('p', { class: 'rules-intro' }, RULES_INTRO),
    list,
    h('p', { class: 'rules-tip' }, h('b', {}, '팁 '), RULES_TIP),
  );
}
