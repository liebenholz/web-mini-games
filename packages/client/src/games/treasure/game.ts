import { treasure } from '@wmg/rules';
import { h, svg } from '../../dom.js';
import { icons } from '../../icons.js';
import type { TreasurePlayerView, TreasureSession, TreasureSnapshot } from './session.js';

const NS = 'http://www.w3.org/2000/svg';
const N = treasure.GRID_SIZE;
const COLS = 'ABCDEFGHI';
const URGENT_MS = 5000;

/** 보물 아이콘 (보석) */
function gemSvg(className: string): SVGElement {
  const node = document.createElementNS(NS, 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('class', className);
  node.setAttribute('fill', 'currentColor');
  const body = document.createElementNS(NS, 'path');
  body.setAttribute('d', 'M6 3h12l4 6-10 12L2 9z');
  body.setAttribute('opacity', '.9');
  const lines = document.createElementNS(NS, 'path');
  lines.setAttribute('d', 'M2 9h20M9 9l3-6 3 6M9 9l3 12 3-12');
  lines.setAttribute('fill', 'none');
  lines.setAttribute('stroke', '#fff');
  lines.setAttribute('stroke-width', '1.2');
  lines.setAttribute('opacity', '.7');
  node.append(body, lines);
  return node;
}

const label = (x: number, y: number) => treasure.cellLabel({ x, y });
const km = (distSq: number) => Math.sqrt(distSq).toFixed(1);

/**
 * 보물 찾기 게임 화면 (treasure.md 8장, 시안 2026-11-28). 업다운·풍선과 같은 틀(참가자 칩, 파티 공통 결과).
 * 키보드: 방향키로 칸 이동, Enter로 선택, Space로 확정
 */
export function mountTreasureGame(
  root: HTMLElement,
  session: TreasureSession,
  onExit: () => void,
): () => void {
  let snap: TreasureSnapshot = session.snapshot;
  /** 키보드 커서 */
  let cursor: { x: number; y: number } | null = null;
  /** 서버 응답 전에 바로 보이게 하는 내가 방금 누른 칸 */
  let local: { roundId: string; x: number; y: number } | null = null;
  let raf = 0;

  const exit = h('button', { class: 'btn btn-ghost back-link', type: 'button' }, svg(icons.back), '나가기');
  exit.addEventListener('click', () => {
    const playing =
      (snap.view.phase === 'PICKING' || snap.view.phase === 'REVEAL') && (me()?.seat ?? -1) >= 0;
    if (!playing || confirm('게임에서 나갈까요? 봇이 이어서 합니다.')) onExit();
  });
  const conn = h('span', { class: 'hint' });
  const count = h('span', { class: 'ud-count' });
  const bar = h('header', { class: 'statusbar ud-bar' }, exit, conn, count);
  const body = h('div', { class: 'ud-body' });
  root.replaceChildren(h('div', { class: 'ud' }, bar, body));

  function me(): TreasurePlayerView | undefined {
    return snap.view.players.find((p) => p.id === snap.me);
  }

  const seated = () => snap.view.players.filter((p) => p.seat >= 0).sort((a, b) => a.seat - b.seat);
  const nameOf = (id: string) => snap.view.players.find((p) => p.id === id)?.nickname ?? '';

  /** 내 현재 선택 (서버가 받은 값, 아니면 방금 누른 값) */
  function myCell(): { x: number; y: number; locked: boolean } | null {
    const v = snap.view;
    const p = snap.myPick;
    if (p && p.roundId === v.roundId) return { x: p.x, y: p.y, locked: p.locked };
    if (local && local.roundId === v.roundId) return { x: local.x, y: local.y, locked: false };
    return null;
  }

  function canPick(): boolean {
    const m = me();
    const mine = myCell();
    return snap.view.phase === 'PICKING' && Boolean(m && m.seat >= 0 && m.inRound) && !mine?.locked;
  }

  function pickCell(x: number, y: number): void {
    if (!canPick()) return;
    local = { roundId: snap.view.roundId, x, y };
    session.send('pick', { x, y, roundId: snap.view.roundId });
    cursor = { x, y };
    paint();
  }

  function lockPick(): void {
    if (!canPick() || !myCell()) return;
    session.send('lock_pick', { roundId: snap.view.roundId });
  }

  function onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) return;
    if (e.metaKey || e.ctrlKey || e.altKey || !canPick()) return;
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = steps[e.key];
    if (d) {
      const start = cursor ?? myCell() ?? { x: 4, y: 4 };
      cursor = {
        x: Math.min(N - 1, Math.max(0, start.x + d[0])),
        y: Math.min(N - 1, Math.max(0, start.y + d[1])),
      };
      paint();
      e.preventDefault();
    } else if (e.key === 'Enter' && cursor) {
      pickCell(cursor.x, cursor.y);
      e.preventDefault();
    } else if (e.key === ' ') {
      lockPick();
      e.preventDefault();
    }
  }
  document.addEventListener('keydown', onKey);

  // ───── 그리기 ─────

  function playersView(): HTMLElement {
    const v = snap.view;
    const picking = v.phase === 'PICKING';
    return h(
      'div',
      { class: `ud-players${seated().length > 6 ? ' ten' : ''}`, 'aria-label': '참가자' },
      ...seated().map((p) => {
        const out = picking && v.replay > 0 && !p.inRound;
        const tag = p.replaced || p.autopilot ? '봇이 대신' : p.isBot ? '봇' : !p.connected ? '끊김' : '';
        return h(
          'div',
          {
            class: `ud-p${out ? ' pass' : ''}${p.id === snap.me ? ' me' : ''}`,
            'aria-label': `${p.nickname}${p.locked ? ', 확정함' : ''}${out ? ', 이번에는 쉬어요' : ''}`,
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
          picking && p.inRound && p.locked ? h('span', { class: 'chk', 'aria-hidden': 'true' }, '✓') : null,
        );
      }),
    );
  }

  /** 9×9 판. 선택 단계에서는 내 선택만, 공개 때는 보물과 모든 선택 */
  function boardView(reveal: boolean): HTMLElement {
    const v = snap.view;
    const mine = myCell();
    const far = new Set(v.reveal.far.split(',').filter(Boolean));
    const byCell = new Map<string, TreasureSnapshot['view']['reveal']['picks'][number][]>();
    if (reveal)
      for (const p of v.reveal.picks) {
        const k = `${p.x},${p.y}`;
        byCell.set(k, [...(byCell.get(k) ?? []), p]);
      }
    const grid = h('div', { class: 'th-grid', role: 'grid', 'aria-label': '보물 찾기 판 9×9' });
    const enabled = !reveal && canPick();
    for (let y = 0; y < N; y += 1)
      for (let x = 0; x < N; x += 1) {
        const isMine = !reveal && mine?.x === x && mine.y === y;
        const isTreasure = reveal && v.reveal.treasureX === x && v.reveal.treasureY === y;
        const picks = byCell.get(`${x},${y}`) ?? [];
        const cls = ['th-cell'];
        if (isMine) cls.push(mine?.locked ? 'locked' : 'sel');
        if (isTreasure) cls.push('treasure');
        if (!reveal && cursor?.x === x && cursor.y === y && !isMine) cls.push('cursor');
        const cell = h('button', {
          class: cls.join(' '),
          type: 'button',
          disabled: !enabled,
          'data-cell': `${x},${y}`,
          'aria-label': `${label(x, y)}${isMine ? ', 내 선택' : ''}${isTreasure ? ', 보물' : ''}`,
          'aria-pressed': isMine ? 'true' : null,
        });
        if (isMine) cell.append(h('span', {}, '●'));
        else if (!reveal && x === 0) cell.append(String(y + 1));
        if (isTreasure) cell.append(gemSvg('gem'));
        for (const p of picks) {
          const seat = snap.view.players.find((q) => q.id === p.playerId)?.seat ?? 0;
          cell.append(
            h(
              'span',
              {
                class: `avatar dot tone-${(seat % 6) + 1}${far.has(p.playerId) ? ' far' : ''}${isTreasure ? ' corner' : ''}`,
                'aria-hidden': 'true',
              },
              p.playerId === snap.me ? '나' : ([...nameOf(p.playerId)][0] ?? ''),
            ),
          );
        }
        if (enabled) cell.addEventListener('click', () => pickCell(x, y));
        grid.append(cell);
      }
    const axis = h(
      'div',
      { class: 'th-axis', 'aria-hidden': 'true' },
      ...[...COLS].map((c) => h('span', {}, c)),
    );
    return h('div', { class: 'th-board' }, axis, grid);
  }

  function headView(): HTMLElement {
    const v = snap.view;
    const inRound = seated().filter((p) => p.inRound);
    const done = inRound.filter((p) => p.locked).length;
    const text =
      v.phase === 'PICKING'
        ? `${v.replay > 0 ? `재대결 ${v.replay}번째 · ` : ''}고르는 중 · ${done}/${inRound.length} 확정`
        : '공개';
    return h(
      'div',
      { class: 'th-head' },
      h(
        'div',
        { class: 'th-lab' },
        h('span', { 'data-testid': 'th-status' }, text),
        h('span', { 'data-seconds': '' }),
      ),
      h('div', { class: 'th-bar' }, h('i', { 'data-timer': '' })),
    );
  }

  function confirmView(): HTMLElement {
    const v = snap.view;
    const m = me();
    const mine = myCell();
    const inRound = seated().filter((p) => p.inRound);
    const done = inRound.filter((p) => p.locked).length;
    if (!m || m.seat < 0 || !m.inRound) {
      return h(
        'button',
        { class: 'btn th-confirm', type: 'button', disabled: true },
        m && m.seat >= 0 ? '이번에는 쉬어요 · 지켜보는 중' : '관전 중',
      );
    }
    if (v.phase !== 'PICKING')
      return h('button', { class: 'btn th-confirm', type: 'button', disabled: true }, '공개 중…');
    if (mine?.locked)
      return h(
        'button',
        { class: 'btn th-confirm', type: 'button', disabled: true, 'data-testid': 'th-locked' },
        `확정했어요 · 기다리는 중 (${done}/${inRound.length})`,
      );
    const btn = h(
      'button',
      { class: 'btn btn-primary th-confirm', type: 'button', disabled: !mine, 'data-testid': 'th-confirm' },
      mine ? `${label(mine.x, mine.y)}로 확정` : '칸을 골라 주세요',
    );
    btn.addEventListener('click', lockPick);
    return btn;
  }

  function rankView(): HTMLElement {
    const v = snap.view;
    const far = v.reveal.far.split(',').filter(Boolean);
    return h(
      'div',
      { class: 'th-rank', 'data-testid': 'th-rank' },
      ...v.reveal.picks.map((p, i) => {
        const seat = v.players.find((q) => q.id === p.playerId)?.seat ?? 0;
        const isFar = i === 0 || far.includes(p.playerId);
        return h(
          'div',
          { class: `row${isFar && p.distSq === (v.reveal.picks[0]?.distSq ?? -1) ? ' far' : ''}` },
          h(
            'span',
            { class: `avatar tone-${(seat % 6) + 1}`, 'aria-hidden': 'true' },
            p.playerId === snap.me ? '나' : ([...nameOf(p.playerId)][0] ?? ''),
          ),
          h('span', { class: 'nm' }, nameOf(p.playerId)),
          p.isAuto ? h('span', { class: 'ud-auto' }, '대신') : null,
          isFar && p.distSq === (v.reveal.picks[0]?.distSq ?? -1)
            ? h('span', { class: 'tag' }, '가장 멀어요')
            : null,
          h('span', { class: 'd' }, `${label(p.x, p.y)} · ${km(p.distSq)}칸`),
        );
      }),
    );
  }

  function noteView(): HTMLElement | null {
    const v = snap.view;
    const names = (ids: string[]) => ids.map(nameOf).join(' 님과 ');
    if (v.phase === 'REVEAL' && v.hasReveal && v.reveal.tie) {
      const ids = v.reveal.far.split(',').filter(Boolean);
      return h(
        'div',
        { class: 'th-note', role: 'status' },
        `${names(ids)} 님이 같은 거리예요. 새 보물로 다시 고릅니다`,
      );
    }
    if (v.phase === 'PICKING' && v.replay > 0) {
      const ids = seated()
        .filter((p) => p.inRound)
        .map((p) => p.id);
      return h(
        'div',
        { class: 'th-note', role: 'status' },
        `${names(ids)} 님이 같은 거리였어요. 새 보물로 다시 고릅니다`,
      );
    }
    const m = me();
    if (v.phase === 'PICKING' && m?.autopilot)
      return h(
        'div',
        { class: 'th-note', role: 'status' },
        '못 골라서 봇이 대신 고르고 있어요. 직접 고르면 돌려받아요',
      );
    return null;
  }

  function resultView(): HTMLElement {
    const v = snap.view;
    const loser = v.players.find((p) => p.id === v.loserId);
    const mine = me();
    const played = Boolean(mine && mine.seat >= 0);
    const hit = v.loserId === snap.me;
    const spot = label(v.reveal.treasureX, v.reveal.treasureY);
    const again = h('button', { class: 'btn btn-primary', type: 'button' }, '다시 하기');
    again.addEventListener('click', () => session.send('rematch', {}));
    const leave = h('button', { class: 'btn', type: 'button' }, '나가기');
    leave.addEventListener('click', onExit);
    const maxPick = v.reveal.picks.find((p) => p.playerId === v.loserId);
    const card = hit
      ? h(
          'section',
          { class: 'th-hit', 'data-testid': 'result' },
          h('div', { class: 'gemb' }, gemSvg('gem')),
          h('p', { class: 't', style: 'color:var(--danger)' }, '당첨!'),
          h(
            'p',
            { class: 's' },
            `보물 ${spot}에서 가장 멀리 골랐어요${maxPick ? ` (${km(maxPick.distSq)}칸)` : ''}${v.tieBreak ? ' · 같은 거리라 무작위로 정해졌어요' : ''}`,
          ),
        )
      : h(
          'section',
          { class: 'th-hit pass', 'data-testid': 'result' },
          h('div', { class: 'ud-pass-ic' }, svg(icons.check)),
          h('p', { class: 't' }, played ? '통과!' : `${loser?.nickname ?? ''} 님 당첨`),
          h(
            'p',
            { class: 's' },
            h('b', {}, loser?.nickname ?? ''),
            ` 님이 가장 멀리 골랐어요 · 보물 ${spot}${v.tieBreak ? ' · 무작위로 정해졌어요' : ''}`,
          ),
        );
    return h(
      'div',
      { class: 'ud-result' },
      card,
      h('div', { class: 'result-actions' }, leave, again),
      h('p', { class: 'ud-sum' }, `${v.replay + 1}번째 단계에서 끝났어요`),
      rankView(),
    );
  }

  function paint(): void {
    const v = snap.view;
    conn.replaceChildren(snap.connection === 'online' ? '' : svg(icons.offline));
    count.textContent =
      v.phase === 'PICKING' ? `${v.replay + 1}번째 선택` : v.phase === 'REVEAL' ? '공개' : '';
    if (v.phase === 'GAME_OVER') {
      body.className = 'ud-body over';
      body.replaceChildren(resultView());
      return;
    }
    body.className = 'ud-body th-body';
    const reveal = v.phase === 'REVEAL' && v.hasReveal;
    const main = h(
      'div',
      { class: 'ud-col main' },
      playersView(),
      noteView() ?? '',
      reveal
        ? h('div', { class: 'th-head' }, h('div', { class: 'th-lab' }, h('span', {}, '공개'), h('span', {})))
        : headView(),
      boardView(reveal),
      reveal ? rankView() : confirmView(),
    );
    body.replaceChildren(main);
    tick();
  }

  function tick(): void {
    cancelAnimationFrame(raf);
    const v = snap.view;
    const timer = body.querySelector<HTMLElement>('[data-timer]');
    const secs = body.querySelector<HTMLElement>('[data-seconds]');
    if (timer && v.phase === 'PICKING' && v.deadline > 0) {
      const left = Math.max(0, v.deadline - session.serverNow());
      timer.style.transform = `scaleX(${Math.min(1, left / (v.options.pickSeconds * 1000))})`;
      timer.parentElement?.classList.toggle('urgent', left <= URGENT_MS);
      if (secs) secs.textContent = `${Math.ceil(left / 1000)}초 남음`;
    }
    raf = requestAnimationFrame(tick);
  }

  const off = session.subscribe((s) => {
    snap = s;
    if (local && local.roundId !== s.view.roundId) local = null;
    if (s.view.phase !== 'PICKING') cursor = null;
    paint();
  });

  return () => {
    off();
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey);
  };
}
