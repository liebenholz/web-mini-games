import { DEFAULT_ROOM_OPTIONS } from '@wmg/rules';
import { h, svg } from '../dom.js';
import { dieSvg, icons } from '../icons.js';

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

/** 규칙 본문 (시트 안에서 위아래로 스크롤된다) */
export function rulesContent(): HTMLElement {
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

let open: { backdrop: HTMLElement; trigger: HTMLElement | null; onKey: (e: KeyboardEvent) => void } | null =
  null;

export function closeRulesSheet(): void {
  if (!open) return;
  document.removeEventListener('keydown', open.onKey);
  open.backdrop.remove();
  document.body.classList.remove('sheet-open');
  if (open.trigger?.isConnected) open.trigger.focus();
  open = null;
}

/** 아래에서 올라오는 규칙 시트. 제목과 확인 버튼은 고정하고 본문만 스크롤한다 */
export function openRulesSheet(trigger: HTMLElement | null = null): void {
  closeRulesSheet();
  const close = h(
    'button',
    { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': '닫기' },
    svg(icons.close),
  );
  const ok = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, '알겠어요');
  const sheet = h(
    'div',
    {
      class: 'rules-sheet',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'rules-title',
      'data-testid': 'rules-sheet',
    },
    h('span', { class: 'sheet-grabber', 'aria-hidden': 'true' }),
    h('div', { class: 'rules-head' }, h('h2', { id: 'rules-title' }, '게임 규칙'), close),
    h('div', { class: 'rules-scroll', tabindex: '0', 'aria-label': '규칙 내용' }, rulesContent()),
    h('div', { class: 'rules-foot' }, ok),
  );
  const backdrop = h('div', { class: 'recall-backdrop' }, sheet);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeRulesSheet();
  });
  close.addEventListener('click', closeRulesSheet);
  ok.addEventListener('click', closeRulesSheet);
  const focusables = [close, sheet.querySelector<HTMLElement>('.rules-scroll'), ok].filter(
    (el): el is HTMLElement => el !== null,
  );
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeRulesSheet();
      return;
    }
    // 시트 밖으로 포커스가 나가지 않게 한다 (aria-modal)
    if (e.key === 'Tab') {
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  document.body.classList.add('sheet-open');
  open = { backdrop, trigger, onKey };
  close.focus();
}

/** 로비 등에서 쓰는 "게임 규칙 보기" 버튼 */
export function rulesButton(): HTMLButtonElement {
  const btn = h(
    'button',
    { class: 'btn rules-btn', type: 'button', 'aria-haspopup': 'dialog', 'data-testid': 'rules-open' },
    svg(icons.book),
    '게임 규칙 보기',
  );
  btn.addEventListener('click', () => openRulesSheet(btn));
  return btn;
}
