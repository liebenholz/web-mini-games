import { balloon } from '@wmg/rules';
import { h, svg } from '../../dom.js';
import { icons } from '../../icons.js';
import type { BalloonPlayerView, BalloonSession, BalloonSnapshot } from './session.js';

const NS = 'http://www.w3.org/2000/svg';
const URGENT_MS = 5000;
/** 방금 분 펌프 알림을 보여 주는 시간 (시안 ②) */
const FLASH_MS = 1500;

/** 풍선 그림. 터지는 범위의 맨 끝(maxPops)에 가까울수록 크고 짙고 팽팽하다 (시안 2026-11-28) */
function balloonSvg(total: number, maxPops: number): SVGElement {
  const t = Math.min(1, total / Math.max(1, maxPops));
  const r = 32 + t * 48;
  const cy = 164 - r;
  const node = document.createElementNS(NS, 'svg');
  node.setAttribute('width', '240');
  node.setAttribute('height', '200');
  node.setAttribute('viewBox', '0 0 240 200');
  node.setAttribute('aria-hidden', 'true');
  node.classList.add('bl-svg');
  const el = (tag: string, attrs: Record<string, string | number>) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  };
  node.append(
    el('path', {
      d: `M120 ${cy + r + 6} q-6 10 4 18 q6 6 -2 12`,
      fill: 'none',
      stroke: 'var(--ink-3)',
      'stroke-width': 2,
    }),
    el('ellipse', {
      class: 'bl-body',
      cx: 120,
      cy,
      rx: r * 0.86,
      ry: r,
      fill: `color-mix(in oklab, var(--p6-bg) ${100 - t * 55}%, var(--danger))`,
      stroke: 'var(--danger)',
      'stroke-width': 1 + t * 2,
      'stroke-opacity': 0.25 + t * 0.6,
    }),
    el('ellipse', {
      cx: 120 - r * 0.3,
      cy: cy - r * 0.35,
      rx: r * 0.14,
      ry: r * 0.24,
      fill: '#fff',
      opacity: 0.55,
      transform: `rotate(25 ${120 - r * 0.3} ${cy - r * 0.35})`,
    }),
    el('path', { d: `M114 ${cy + r + 4} l6 -8 l6 8z`, fill: 'var(--danger)', opacity: 0.7 }),
  );
  return node;
}

/** 터진 풍선: 조각이 사방으로 흩어진다 */
function popSvg(): SVGElement {
  const node = document.createElementNS(NS, 'svg');
  node.setAttribute('width', '150');
  node.setAttribute('height', '150');
  node.setAttribute('viewBox', '30 10 180 180');
  node.setAttribute('aria-hidden', 'true');
  node.classList.add('bl-pop');
  for (let i = 0; i < 14; i += 1) {
    const a = (i / 14) * Math.PI * 2;
    const d = 55 + (i % 3) * 14;
    const p = document.createElementNS(NS, 'path');
    p.setAttribute(
      'd',
      `M${120 + Math.cos(a) * 20} ${100 + Math.sin(a) * 20} L${120 + Math.cos(a) * d} ${100 + Math.sin(a) * d}`,
    );
    p.setAttribute('stroke', 'var(--danger)');
    p.setAttribute('stroke-width', String(3 + (i % 3)));
    p.setAttribute('stroke-linecap', 'round');
    node.append(p);
  }
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('x', '120');
  t.setAttribute('y', '108');
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('font-size', '30');
  t.setAttribute('font-weight', '800');
  t.setAttribute('fill', 'var(--danger)');
  t.textContent = '펑!';
  node.append(t);
  return node;
}

/**
 * 풍선 터뜨리기 게임 화면 (balloon.md 8장, 시안 2026-11-28). 업다운과 같은 틀(참가자 줄, 기록, 당첨/통과 결과).
 * 키보드: Space 또는 Enter = 바람 넣기, → = 넘기기
 */
export function mountBalloonGame(root: HTMLElement, session: BalloonSession, onExit: () => void): () => void {
  let snap: BalloonSnapshot = session.snapshot;
  let raf = 0;

  const exit = h('button', { class: 'btn btn-ghost back-link', type: 'button' }, svg(icons.back), '나가기');
  exit.addEventListener('click', () => {
    const playing = snap.view.phase === 'PLAYING' && (me()?.seat ?? -1) >= 0;
    if (!playing || confirm('게임에서 나갈까요? 봇이 이어서 합니다.')) onExit();
  });
  const conn = h('span', { class: 'hint' });
  const count = h('span', { class: 'ud-count' });
  const bar = h('header', { class: 'statusbar ud-bar' }, exit, conn, count);
  const body = h('div', { class: 'ud-body' });
  root.replaceChildren(h('div', { class: 'ud' }, bar, body));

  function me(): BalloonPlayerView | undefined {
    return snap.view.players.find((p) => p.id === snap.me);
  }

  function seated(): BalloonPlayerView[] {
    return snap.view.players.filter((p) => p.seat >= 0).sort((a, b) => a.seat - b.seat);
  }

  function nameOf(id: string): string {
    return snap.view.players.find((p) => p.id === id)?.nickname ?? '';
  }

  function myTurn(): boolean {
    const v = snap.view;
    const m = me();
    return v.phase === 'PLAYING' && Boolean(m && m.seat >= 0) && v.currentTurn === snap.me;
  }

  const canPump = () => myTurn() && snap.view.turnPumps < balloon.MAX_PUMPS_PER_TURN;
  const canEnd = () => myTurn() && snap.view.turnPumps >= 1;

  function pump(): void {
    if (canPump()) session.send('pump', { turnId: snap.view.turnId });
  }

  function endTurn(): void {
    if (canEnd()) session.send('end_turn', { turnId: snap.view.turnId });
  }

  function onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' || e.key === 'Enter') {
      pump();
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      endTurn();
      e.preventDefault();
    }
  }
  document.addEventListener('keydown', onKey);

  // ───── 그리기 ─────

  function playersView(): HTMLElement {
    const v = snap.view;
    return h(
      'div',
      { class: `ud-players${seated().length > 6 ? ' ten' : ''}`, 'aria-label': '참가자' },
      ...seated().map((p) => {
        const active = v.phase === 'PLAYING' && v.currentTurn === p.id;
        const tag = p.replaced || p.autopilot ? '봇이 대신' : p.isBot ? '봇' : !p.connected ? '끊김' : '';
        return h(
          'div',
          {
            class: `ud-p${active ? ' active' : ''}${p.id === snap.me ? ' me' : ''}`,
            'aria-current': active ? 'true' : null,
          },
          h(
            'span',
            { class: `avatar tone-${(p.seat % 6) + 1}`, 'aria-hidden': 'true' },
            p.id === snap.me ? '나' : ([...p.nickname][0] ?? ''),
          ),
          h('span', { class: 'nm' }, p.nickname),
          tag
            ? h(
                'span',
                { class: `ud-tag${tag === '끊김' ? ' off' : ''}${tag === '봇' ? ' plain' : ''}` },
                tag,
              )
            : null,
          active ? h('span', { class: 'ud-t', 'data-timer': '' }, h('i')) : null,
        );
      }),
    );
  }

  function stageView(): HTMLElement {
    const v = snap.view;
    const safe = Math.min(100, (v.total / Math.max(1, v.maxPops)) * 100);
    return h(
      'section',
      { class: 'bl-stage', 'aria-label': `풍선, 지금까지 ${v.total}번 불었어요` },
      h(
        'div',
        { class: 'lab' },
        h('span', {}, '풍선'),
        h('span', {}, `${balloon.MIN_THRESHOLD}~${v.maxPops}번 사이에서 터져요`),
      ),
      h('div', { class: 'bl-air', key: String(v.total) }, balloonSvg(v.total, v.maxPops)),
      h(
        'div',
        { class: 'bl-count', 'data-testid': 'bl-total' },
        String(v.total),
        h('small', {}, '번 불었어요'),
      ),
      h(
        'div',
        { class: 'bl-meter', 'aria-hidden': 'true' },
        h('span', { class: 'safe', style: `width:${safe}%` }),
        h('span', { class: 'zone', style: `left:${safe}%` }),
      ),
      h(
        'p',
        { class: 'bl-range' },
        ...(v.total >= balloon.MIN_THRESHOLD
          ? ['지금부터는 ', h('b', {}, '언제든 터질 수 있어요')]
          : [`아직은 터지지 않아요 (${balloon.MIN_THRESHOLD}번부터 터질 수 있어요)`]),
      ),
    );
  }

  function dots(n: number): HTMLElement {
    return h(
      'div',
      { class: 'bl-dots', 'aria-label': `이번 차례 ${n}번` },
      ...[0, 1, 2].map((i) => h('i', { class: i < n ? 'on' : '' })),
    );
  }

  function controlsView(): HTMLElement {
    const v = snap.view;
    if (!myTurn()) {
      const m = me();
      const current = v.players.find((p) => p.id === v.currentTurn);
      const n = seated().length;
      const ahead = m && current ? (m.seat - current.seat + n) % n : -1;
      const sub = !m || m.seat < 0 || ahead < 0 ? '관전 중' : `내 차례는 ${ahead}명 뒤`;
      return h(
        'div',
        { class: 'ud-wait bl-wait', role: 'status' },
        h(
          'div',
          {},
          v.phase === 'STARTING'
            ? h('b', {}, '곧 시작합니다')
            : h('span', {}, h('b', {}, current?.nickname ?? ''), ' 님이 부는 중'),
          h('br'),
          h('span', { class: 'hint' }, v.phase === 'STARTING' ? '풍선을 준비하는 중이에요' : sub),
        ),
      );
    }
    const left = balloon.MAX_PUMPS_PER_TURN - v.turnPumps;
    const pumpBtn = h(
      'button',
      { class: 'btn btn-primary bl-pump', type: 'button', disabled: !canPump(), 'data-testid': 'bl-pump' },
      `바람 넣기 (${left}번 남음)`,
    );
    pumpBtn.addEventListener('click', pump);
    const endBtn = h(
      'button',
      { class: 'btn', type: 'button', disabled: !canEnd(), 'data-testid': 'bl-end' },
      '넘기기',
    );
    endBtn.addEventListener('click', endTurn);
    return h('div', { class: 'bl-controls' }, h('div', { class: 'bl-actions' }, pumpBtn, endBtn));
  }

  function flashView(): HTMLElement | null {
    const v = snap.view;
    if (v.phase !== 'PLAYING') return null;
    const f = snap.flash;
    const now = Date.now();
    const m = me();
    if (f && now - f.at < FLASH_MS * 2 && f.isAuto && f.playerId === snap.me)
      return h(
        'div',
        { class: 'ud-flash bot', role: 'status' },
        svg(icons.robot),
        h(
          'span',
          {},
          m?.autopilot
            ? '봇이 대신 불고 있어요. 직접 누르면 돌려받아요'
            : '시간이 지나 대신 불었어요. 한 번 더 지나면 봇이 이어서 해요',
        ),
      );
    if (f && now - f.at < FLASH_MS && f.playerId !== snap.me)
      return h(
        'div',
        { class: 'ud-flash up', role: 'status' },
        svg(icons.arrowUp),
        h('span', {}, `${nameOf(f.playerId)} · ${f.turnPumps}번째 바람을 불었어요`),
      );
    const n = snap.notice;
    if (n && n.playerId !== snap.me) {
      const p = v.players.find((x) => x.id === n.playerId);
      if (n.reason === 'left' && now - n.at < 8000)
        return h(
          'div',
          { class: 'ud-flash bot', role: 'status' },
          svg(icons.robot),
          `${n.nickname} 님이 나가서 봇이 이어서 해요`,
        );
      if (n.reason === 'disconnected' && p && !p.connected)
        return h(
          'div',
          { class: 'ud-flash off', role: 'status' },
          svg(icons.wifiOff),
          `${n.nickname} 님 연결 끊김 · 시간이 지나면 대신 불어요`,
        );
    }
    return null;
  }

  function logView(): HTMLElement {
    const rows = [...snap.view.history].reverse();
    return h(
      'section',
      { class: 'ud-log', 'aria-label': '기록' },
      h('h3', {}, '기록'),
      rows.length === 0
        ? h('p', { class: 'hint' }, '아직 아무도 불지 않았어요')
        : h(
            'ol',
            { 'data-testid': 'bl-log' },
            ...rows.map((t, i) =>
              h(
                'li',
                { class: `ud-row${i === 0 ? ' fresh' : ''}` },
                h(
                  'span',
                  { class: 'who' },
                  t.playerId === snap.me ? `${nameOf(t.playerId)} (나)` : nameOf(t.playerId),
                ),
                t.isAuto ? h('span', { class: 'ud-auto' }, '대신') : null,
                h('span', { class: 'n' }, `${t.pumps}번`),
                h('span', { class: `res ${t.popped ? 'bomb' : 'up'}` }, t.popped ? '펑!' : '넘김'),
              ),
            ),
          ),
    );
  }

  function resultView(): HTMLElement {
    const v = snap.view;
    const loser = v.players.find((p) => p.id === v.loserId);
    const mine = me();
    const played = Boolean(mine && mine.seat >= 0);
    const hit = v.loserId === snap.me;
    const again = h('button', { class: 'btn btn-primary', type: 'button' }, '다시 하기');
    again.addEventListener('click', () => session.send('rematch', {}));
    const leave = h('button', { class: 'btn', type: 'button' }, '나가기');
    leave.addEventListener('click', onExit);
    const card = hit
      ? h(
          'section',
          { class: 'ud-hit', 'data-testid': 'result' },
          h('div', { class: 'bl-air pop' }, popSvg()),
          h('div', { class: 'ud-bombnum' }, `${v.threshold}번째`),
          h('p', { class: 'title' }, '당첨!'),
          h('p', { class: 'sub' }, `터지는 횟수는 ${v.threshold}번이었어요`),
        )
      : h(
          'section',
          { class: 'ud-hit pass', 'data-testid': 'result' },
          h('div', { class: 'ud-pass-ic' }, svg(icons.check)),
          h('p', { class: 'title' }, played ? '통과!' : `${loser?.nickname ?? ''} 님 당첨`),
          h(
            'span',
            { class: `avatar tone-${((loser?.seat ?? 0) % 6) + 1}`, 'aria-hidden': 'true' },
            [...(loser?.nickname ?? '?')][0] ?? '?',
          ),
          h(
            'p',
            { class: 'sub' },
            h('b', {}, loser?.nickname ?? ''),
            ' 님 당첨 · 터지는 횟수 ',
            h('b', { class: 'bombtext' }, String(v.threshold)),
            '번',
          ),
        );
    return h(
      'div',
      { class: 'ud-result' },
      card,
      h('p', { class: 'ud-sum' }, `${v.history.length}차례 · 전체 ${v.threshold}번`),
      h('div', { class: 'result-actions' }, leave, again),
      logView(),
    );
  }

  function paint(): void {
    const v = snap.view;
    conn.replaceChildren(snap.connection === 'online' ? '' : svg(icons.offline));
    count.textContent = v.phase === 'PLAYING' ? `${v.history.length + 1}번째 차례` : '';
    if (v.phase === 'GAME_OVER') {
      body.className = 'ud-body over';
      body.replaceChildren(resultView());
      return;
    }
    body.className = 'ud-body bl-body-wrap';
    const slot = h('div', { class: 'ud-flash-slot' }, flashView() ?? '');
    const main = h('div', { class: 'ud-col main' }, slot, stageView(), dots(v.turnPumps), controlsView());
    const side = h('div', { class: 'ud-col side' }, playersView(), logView());
    body.replaceChildren(main, side);
    tick();
  }

  function tick(): void {
    cancelAnimationFrame(raf);
    const v = snap.view;
    const bar = body.querySelector<HTMLElement>('[data-timer] i');
    if (bar && v.phase === 'PLAYING' && v.deadline > 0) {
      const left = Math.max(0, v.deadline - session.serverNow());
      bar.style.transform = `scaleX(${Math.min(1, left / (v.options.turnSeconds * 1000))})`;
      bar.parentElement?.classList.toggle('urgent', left <= URGENT_MS);
    }
    raf = requestAnimationFrame(tick);
  }

  const off = session.subscribe((s) => {
    snap = s;
    paint();
  });
  const flashTimer = window.setInterval(() => {
    if (snap.view.phase !== 'PLAYING') return;
    const slot = body.querySelector('.ud-flash-slot');
    const f = flashView();
    if (slot && Boolean(slot.firstElementChild) !== Boolean(f)) slot.replaceChildren(f ?? '');
  }, 300);

  return () => {
    off();
    cancelAnimationFrame(raf);
    window.clearInterval(flashTimer);
    document.removeEventListener('keydown', onKey);
  };
}
