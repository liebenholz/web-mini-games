import {
  DEFAULT_STATS_RANGE,
  STATS_RANGES,
  totalGames,
  type DailyStats,
  type StatsRange,
  type StatsResponse,
} from '@wmg/rules';
import { h, svg } from '../dom.js';
import { GAMES } from '../games/registry.js';
import { icons } from '../icons.js';
import { axisTicks, labelIndexes, longDate, shortDate } from '../statsChart.js';

/**
 * 운영 통계 대시보드 /stats (docs/specs/stats.md). 링크를 아는 사람은 누구나 본다 (ST-07: 숫자 합계만).
 * 그래프는 SVG로 직접 그린다. 칸 폭에 맞춰 다시 그려서 폰에서도 글자가 작아지지 않는다.
 */
export interface StatsActions {
  load(range: StatsRange): Promise<StatsResponse>;
  back(): void;
}

interface Series {
  readonly key: string;
  readonly label: string;
  /** CSS 색 (토큰) */
  readonly color: string;
  readonly values: readonly number[];
}

const NS = 'http://www.w3.org/2000/svg';
const GAME_COLORS = [
  'var(--p1-fg)',
  'var(--p2-fg)',
  'var(--p3-fg)',
  'var(--p4-fg)',
  'var(--p5-fg)',
  'var(--p6-fg)',
];

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  style: Partial<Record<'fill' | 'stroke', string>> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (style.fill) node.style.fill = style.fill;
  if (style.stroke) node.style.stroke = style.stroke;
  return node;
}

/** 게임 종류(서버 방 이름) → 이름과 색. 카탈로그 순서, 모르는 종류는 뒤에 */
export function gameSeries(days: readonly DailyStats[]): Series[] {
  const types = new Set(days.flatMap((d) => Object.keys(d.games)));
  const known = GAMES.filter((g) => g.roomType && types.has(g.roomType)).map((g) => ({
    key: g.roomType as string,
    label: g.name,
  }));
  const others = [...types]
    .filter((t) => !known.some((k) => k.key === t))
    .sort()
    .map((t) => ({ key: t, label: t }));
  return [...known, ...others].map((s, i) => ({
    ...s,
    color: GAME_COLORS[i % GAME_COLORS.length] as string,
    values: days.map((d) => d.games[s.key] ?? 0),
  }));
}

interface ChartSpec {
  readonly kind: 'line' | 'stack';
  readonly dates: readonly string[];
  readonly series: readonly Series[];
}

const PAD = { top: 12, right: 8, bottom: 26, left: 32 };
const HEIGHT = 200;

function drawChart(
  host: HTMLElement,
  spec: ChartSpec,
  selected: number,
  onSelect: (i: number) => void,
): void {
  const width = Math.max(240, Math.floor(host.clientWidth));
  const n = spec.dates.length;
  const totals = spec.dates.map((_, i) =>
    spec.kind === 'stack'
      ? spec.series.reduce((a, s) => a + (s.values[i] ?? 0), 0)
      : Math.max(0, ...spec.series.map((s) => s.values[i] ?? 0)),
  );
  const ticks = axisTicks(Math.max(0, ...totals));
  const top = ticks.at(-1) ?? 4;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(1, n);
  const x = (i: number) => PAD.left + slot * (i + 0.5);
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;

  const root = el('svg', { width, height: HEIGHT, viewBox: `0 0 ${width} ${HEIGHT}`, 'aria-hidden': 'true' });
  root.classList.add('chart-svg');

  for (const t of ticks) {
    root.append(el('line', { x1: PAD.left, x2: width - PAD.right, y1: y(t), y2: y(t), class: 'chart-grid' }));
    const label = el('text', { x: PAD.left - 6, y: y(t) + 4, 'text-anchor': 'end', class: 'chart-tick' });
    label.textContent = String(t);
    root.append(label);
  }
  for (const i of labelIndexes(n, width < 420 ? 4 : 7)) {
    // 양 끝 날짜는 칸 밖으로 잘리지 않게 안쪽으로 붙인다
    const edge = n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle';
    const lx = edge === 'start' ? PAD.left : edge === 'end' ? width - PAD.right : x(i);
    const label = el('text', { x: lx, y: HEIGHT - 8, 'text-anchor': edge, class: 'chart-tick' });
    label.textContent = shortDate(spec.dates[i] ?? '');
    root.append(label);
  }

  // 고른 날 강조 (막대 뒤)
  if (selected >= 0 && selected < n) {
    root.append(
      el('rect', { x: x(selected) - slot / 2, y: PAD.top, width: slot, height: plotH, class: 'chart-focus' }),
    );
  }

  if (spec.kind === 'stack') {
    const barW = Math.max(2, Math.min(28, slot * 0.7));
    for (let i = 0; i < n; i += 1) {
      let base = 0;
      for (const s of spec.series) {
        const v = s.values[i] ?? 0;
        if (v <= 0) continue;
        const y0 = y(base);
        const y1 = y(base + v);
        // 위아래 조각 사이 1px 틈
        root.append(
          el(
            'rect',
            { x: x(i) - barW / 2, y: y1, width: barW, height: Math.max(1, y0 - y1 - 1), rx: 2 },
            { fill: s.color },
          ),
        );
        base += v;
      }
    }
  } else {
    for (const s of spec.series) {
      const d = s.values
        .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
        .join('');
      root.append(el('path', { d, class: 'chart-line' }, { stroke: s.color }));
      if (selected >= 0 && selected < n) {
        root.append(
          el(
            'circle',
            { cx: x(selected), cy: y(s.values[selected] ?? 0), r: 4, class: 'chart-dot' },
            { stroke: s.color },
          ),
        );
      }
    }
  }

  // 날짜 고르기: 가까운 칸
  const pick = (event: PointerEvent) => {
    const box = root.getBoundingClientRect();
    const i = Math.floor((event.clientX - box.left - PAD.left) / slot);
    if (i >= 0 && i < n && i !== selected) onSelect(i);
  };
  root.addEventListener('pointerdown', pick);
  root.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' || e.buttons > 0) pick(e);
  });
  host.replaceChildren(root);
}

function legend(series: readonly Series[], values: (s: Series) => string): HTMLElement {
  return h(
    'ul',
    { class: 'chart-legend' },
    ...series.map((s) => {
      const swatch = h('span', { class: 'chart-swatch', 'aria-hidden': 'true' });
      swatch.style.background = s.color;
      return h('li', {}, swatch, h('span', {}, s.label), h('strong', {}, values(s)));
    }),
  );
}

function dataTable(caption: string, dates: readonly string[], series: readonly Series[]): HTMLElement {
  return h(
    'details',
    { class: 'chart-table' },
    h('summary', {}, '표로 보기'),
    h(
      'div',
      { class: 'chart-table-scroll' },
      h(
        'table',
        {},
        h('caption', { class: 'sr-only' }, caption),
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'col' }, '날짜'),
            ...series.map((s) => h('th', { scope: 'col' }, s.label)),
          ),
        ),
        h(
          'tbody',
          {},
          ...dates
            .map((d, i) =>
              h(
                'tr',
                {},
                h('th', { scope: 'row' }, shortDate(d)),
                ...series.map((s) => h('td', {}, String(s.values[i] ?? 0))),
              ),
            )
            .reverse(),
        ),
      ),
    ),
  );
}

function chartCard(
  title: string,
  spec: ChartSpec,
  readout: (i: number) => string,
  totalsLabel: (s: Series) => string,
  testId: string,
): { card: HTMLElement; redraw: () => void } {
  let selected = spec.dates.length - 1;
  const plot = h('div', { class: 'chart-plot' });
  const read = h('p', { class: 'chart-readout', 'aria-live': 'polite' });
  const redraw = () => {
    read.textContent = readout(selected);
    drawChart(plot, spec, selected, (i) => {
      selected = i;
      redraw();
    });
  };
  const summary = spec.series.map((s) => `${s.label} ${totalsLabel(s)}`).join(', ');
  const card = h(
    'section',
    { class: 'card chart-card', 'data-testid': testId, 'aria-label': `${title}: ${summary}` },
    h('h2', {}, title),
    legend(spec.series, totalsLabel),
    read,
    plot,
    dataTable(title, spec.dates, spec.series),
  );
  return { card, redraw };
}

function tile(label: string, value: number, testId: string): HTMLElement {
  return h(
    'div',
    { class: 'stat-tile', 'data-testid': testId },
    h('span', { class: 'stat-label' }, label),
    h('strong', { class: 'stat-value' }, value.toLocaleString('ko-KR')),
  );
}

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

function renderData(data: StatsResponse): { nodes: HTMLElement[]; redraw: () => void } {
  const days = data.days;
  const dates = days.map((d) => d.date);
  const today = days.at(-1);
  const people: Series[] = [
    { key: 'visitors', label: '방문자', color: 'var(--accent)', values: days.map((d) => d.visitors) },
    { key: 'players', label: '참여자', color: 'var(--success)', values: days.map((d) => d.players) },
  ];
  const games = gameSeries(days);
  const avg = (s: Series) => `평균 ${(sum(s.values) / Math.max(1, s.values.length)).toFixed(1)}`;

  const visitors = chartCard(
    '일일 접속자',
    { kind: 'line', dates, series: people },
    (i) =>
      `${longDate(dates[i] ?? '')} · 방문자 ${people[0]?.values[i] ?? 0}명 · 참여자 ${people[1]?.values[i] ?? 0}명`,
    avg,
    'chart-people',
  );
  const played = chartCard(
    '일일 판 수',
    { kind: 'stack', dates, series: games },
    (i) => {
      const parts = games.filter((s) => (s.values[i] ?? 0) > 0).map((s) => `${s.label} ${s.values[i]}`);
      const total = days[i] ? totalGames(days[i]) : 0;
      return `${longDate(dates[i] ?? '')} · ${total}판${parts.length ? ` (${parts.join(', ')})` : ''}`;
    },
    (s) => `${sum(s.values)}판`,
    'chart-games',
  );
  const emptyGames =
    games.length === 0 ? h('p', { class: 'hint chart-empty' }, '이 기간에 끝난 판이 없습니다.') : null;
  if (emptyGames) played.card.querySelector('.chart-plot')?.before(emptyGames);

  const tiles = h(
    'div',
    { class: 'stat-tiles' },
    tile('오늘 방문자', today?.visitors ?? 0, 'today-visitors'),
    tile('오늘 참여자', today?.players ?? 0, 'today-players'),
    tile('오늘 판 수', today ? totalGames(today) : 0, 'today-games'),
    tile(`${data.range}일 판 수`, sum(days.map(totalGames)), 'range-games'),
  );
  return {
    nodes: [tiles, visitors.card, played.card],
    redraw: () => {
      visitors.redraw();
      played.redraw();
    },
  };
}

export function renderStats(actions: StatsActions): { node: HTMLElement; dispose: () => void } {
  let range: StatsRange = DEFAULT_STATS_RANGE;
  let redraw: (() => void) | null = null;
  let request = 0;

  const body = h('div', { class: 'stats-body', 'aria-busy': 'true' });
  const updated = h('p', { class: 'hint' });
  const buttons = STATS_RANGES.map((r) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(r === range) }, `${r}일`);
    b.addEventListener('click', () => {
      if (r === range) return;
      range = r;
      for (const [i, other] of buttons.entries())
        other.setAttribute('aria-pressed', String(STATS_RANGES[i] === r));
      void load();
    });
    return b;
  });

  async function load(): Promise<void> {
    const id = (request += 1);
    body.setAttribute('aria-busy', 'true');
    if (!redraw) body.replaceChildren(h('div', { class: 'spinner', 'aria-label': '불러오는 중' }));
    try {
      const data = await actions.load(range);
      if (id !== request) return;
      const view = renderData(data);
      body.replaceChildren(...view.nodes);
      redraw = view.redraw;
      redraw();
      const at = new Date(data.generatedAt);
      updated.textContent = `한국 시간 기준 · ${at.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 집계 · 봇 제외`;
    } catch {
      if (id !== request) return;
      redraw = null;
      const retry = h('button', { class: 'btn', type: 'button' }, '다시 불러오기');
      retry.addEventListener('click', () => void load());
      body.replaceChildren(
        h('div', { class: 'card stack centered' }, h('p', {}, '통계를 불러오지 못했습니다.'), retry),
      );
    } finally {
      if (id === request) body.setAttribute('aria-busy', 'false');
    }
  }

  const back = h(
    'button',
    { class: 'btn btn-ghost back-link', type: 'button' },
    svg(icons.back),
    '게임 목록',
  );
  back.addEventListener('click', () => actions.back());

  const node = h(
    'main',
    { class: 'page stats-page', 'data-testid': 'stats' },
    h('nav', { class: 'lobby-nav', 'aria-label': '이동' }, back),
    h(
      'header',
      { class: 'stats-head' },
      h('div', { class: 'stack' }, h('h1', {}, '통계'), updated),
      h('div', { class: 'segmented', role: 'group', 'aria-label': '기간' }, ...buttons),
    ),
    body,
  );

  // 칸 폭이 바뀌면 다시 그린다 (회전, 창 크기)
  let lastWidth = 0;
  const observer = new ResizeObserver(() => {
    const w = body.clientWidth;
    if (w === lastWidth) return;
    lastWidth = w;
    redraw?.();
  });
  observer.observe(body);
  void load();
  return { node, dispose: () => observer.disconnect() };
}
