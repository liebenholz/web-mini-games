import { yacht } from '@wmg/rules';
import { h, svg } from '../../dom.js';
import { dieSvg, icons } from '../../icons.js';
import type { YachtPlayerView, YachtSession, YachtSnapshot } from './session.js';

const URGENT_MS = 5000;
const FLASH_MS = 3500;
const ROLL_ANIM_MS = 450;

/**
 * 요트 주사위 게임 화면 (yacht.md 8장, 시안 2026-11-28).
 * 키보드: 1~5 = 그 주사위 고정/해제, R = 굴리기, ↑↓ = 칸 선택, Enter 또는 Space = 기록
 */
export function mountYachtGame(root: HTMLElement, session: YachtSession, onExit: () => void): () => void {
  let snap: YachtSnapshot = session.snapshot;
  let raf = 0;
  /** 내가 다음 굴림에서 남길 주사위 */
  let keep: boolean[] = new Array<boolean>(yacht.DICE_COUNT).fill(false);
  let sel: number | null = null;
  let lastTurnId = '';
  let lastRollNo = 0;
  let rollingUntil = 0;

  const exit = h('button', { class: 'btn btn-ghost back-link', type: 'button' }, svg(icons.back), '나가기');
  exit.addEventListener('click', () => {
    const playing = snap.view.phase === 'PLAYING' && (me()?.seat ?? -1) >= 0;
    if (!playing || confirm('게임에서 나갈까요? 봇이 이어서 합니다.')) onExit();
  });
  const conn = h('span', { class: 'hint' });
  const count = h('span', { class: 'ud-count' });
  const bar = h('header', { class: 'statusbar ud-bar' }, exit, conn, count);
  const body = h('div', { class: 'yt-col' });
  root.replaceChildren(h('div', { class: 'ud' }, bar, body));

  function me(): YachtPlayerView | undefined {
    return snap.view.players.find((p) => p.id === snap.me);
  }

  function seated(): YachtPlayerView[] {
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

  const rollsLeft = () => yacht.MAX_ROLLS - snap.view.rollNo;
  const hasRolled = () => snap.view.rollNo > 0;
  const canToggle = () => myTurn() && hasRolled() && rollsLeft() > 0;
  const canRoll = () => myTurn() && rollsLeft() > 0 && (!hasRolled() || !keep.every(Boolean));
  const openCats = (p: YachtPlayerView) =>
    Array.from({ length: yacht.CATEGORY_COUNT }, (_, c) => c).filter((c) => p.scores[c] === yacht.EMPTY);

  function points(cat: number): number {
    return yacht.scoreCategory(snap.view.dice, cat);
  }

  function roll(): void {
    if (!canRoll()) return;
    session.send('roll', {
      keep: hasRolled() ? [...keep] : new Array<boolean>(5).fill(false),
      turnId: snap.view.turnId,
    });
  }

  function record(): void {
    if (!myTurn() || !hasRolled() || sel === null) return;
    session.send('score', { category: sel, turnId: snap.view.turnId });
    sel = null;
  }

  function toggleDie(i: number): void {
    if (!canToggle()) return;
    keep[i] = !keep[i];
    paint();
  }

  function moveSel(dir: 1 | -1): void {
    const m = me();
    if (!m || !myTurn() || !hasRolled()) return;
    const open = openCats(m);
    if (open.length === 0) return;
    const at = sel === null ? -1 : open.indexOf(sel);
    const next = at < 0 ? (dir === 1 ? 0 : open.length - 1) : (at + dir + open.length) % open.length;
    sel = open[next] ?? null;
    paint();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter')) return;
    if (e.key >= '1' && e.key <= '5') {
      toggleDie(Number(e.key) - 1);
      e.preventDefault();
    } else if (e.key === 'r' || e.key === 'R') {
      roll();
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      moveSel(1);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      moveSel(-1);
      e.preventDefault();
    } else if (e.key === 'Enter' || e.key === ' ') {
      record();
      e.preventDefault();
    }
  }
  document.addEventListener('keydown', onKey);

  // ───── 그리기 ─────

  function playersView(): HTMLElement {
    const v = snap.view;
    const list = seated();
    return h(
      'div',
      { class: `yt-players n${list.length}`, 'aria-label': '참가자' },
      ...list.map((p) => {
        const active = v.phase === 'PLAYING' && v.currentTurn === p.id;
        const tag = p.replaced || p.autopilot ? '봇이 대신' : !p.connected ? '끊김' : '';
        return h(
          'div',
          {
            class: `yt-p${active ? ' active' : ''}${p.id === snap.me ? ' me' : ''}`,
            'aria-current': active ? 'true' : null,
          },
          h(
            'span',
            { class: `avatar tone-${(p.seat % 6) + 1}`, 'aria-hidden': 'true' },
            p.id === snap.me ? '나' : ([...p.nickname][0] ?? ''),
          ),
          h('span', { class: 'nm' }, p.nickname),
          tag ? h('span', { class: `ud-tag${tag === '끊김' ? ' off' : ''}` }, tag) : null,
          h('span', { class: 'tot', 'data-testid': 'yt-total' }, String(p.total)),
          active ? h('span', { class: 't', 'data-timer': '' }, h('i')) : null,
        );
      }),
    );
  }

  function noteView(): HTMLElement | null {
    const v = snap.view;
    if (v.phase === 'STARTING') return h('div', { class: 'yt-note', role: 'status' }, '곧 시작합니다');
    const f = snap.flash;
    const now = Date.now();
    if (f && now - f.at < FLASH_MS) {
      if (f.isAuto && f.playerId === snap.me)
        return h(
          'div',
          { class: 'yt-note bot', role: 'status' },
          svg(icons.robot),
          me()?.autopilot
            ? '봇이 대신 기록하고 있어요. 직접 누르면 돌려받아요'
            : '시간이 지나 대신 기록했어요. 한 번 더 지나면 봇이 이어서 해요',
        );
      return h(
        'div',
        { class: 'yt-note', role: 'status' },
        `${nameOf(f.playerId)} · ${yacht.CATEGORY_NAMES[f.category] ?? ''} ${f.points}점${f.isAuto ? ' (대신)' : ''}`,
      );
    }
    const n = snap.notice;
    if (n && n.playerId !== snap.me) {
      const p = v.players.find((x) => x.id === n.playerId);
      if (n.reason === 'left' && now - n.at < 8000)
        return h(
          'div',
          { class: 'yt-note bot', role: 'status' },
          svg(icons.robot),
          `${n.nickname} 님이 나가서 봇이 이어서 해요`,
        );
      if (n.reason === 'disconnected' && p && !p.connected)
        return h(
          'div',
          { class: 'yt-note off', role: 'status' },
          svg(icons.wifiOff),
          `${n.nickname} 님 연결 끊김`,
        );
    }
    if (myTurn() && !hasRolled())
      return h('div', { class: 'yt-note', role: 'status' }, '내 차례예요. 주사위를 굴려요');
    return null;
  }

  function trayView(): HTMLElement {
    const v = snap.view;
    const mine = myTurn();
    const rolled = v.dice.length === yacht.DICE_COUNT;
    const rolling = Date.now() < rollingUntil;
    const dice = Array.from({ length: yacht.DICE_COUNT }, (_, i) => {
      const value = v.dice[i];
      const held = mine ? keep[i] === true && hasRolled() : v.held[i] === 1 && v.rollNo > 1;
      const cls = `yt-die${held ? ' held' : ''}${!rolled ? ' blank' : ''}${rolling && !held ? ' rolling' : ''}`;
      const face = rolled && value ? svg(dieSvg(value, `${value}`)) : null;
      const btn = h(
        'button',
        {
          class: cls,
          type: 'button',
          disabled: !canToggle(),
          'aria-pressed': mine && hasRolled() ? String(held) : null,
          'aria-label': rolled ? `${i + 1}번 주사위 ${value}${held ? ', 고정됨' : ''}` : `${i + 1}번 주사위`,
          'data-testid': `yt-die-${i}`,
        },
        face,
        held ? h('span', { class: 'hold' }, '고정') : null,
      );
      btn.addEventListener('click', () => toggleDie(i));
      return btn;
    });
    return h(
      'section',
      { class: 'yt-tray', 'aria-label': '주사위' },
      h('div', { class: 'yt-dice' }, ...dice),
      controlsView(),
    );
  }

  function controlsView(): HTMLElement {
    const v = snap.view;
    if (!myTurn()) {
      const current = v.players.find((p) => p.id === v.currentTurn);
      const m = me();
      const n = seated().length;
      const ahead = m && current && m.seat >= 0 ? (m.seat - current.seat + n) % n : -1;
      return h(
        'div',
        { class: 'yt-wait', role: 'status' },
        v.phase === 'PLAYING'
          ? h(
              'span',
              {},
              h('b', {}, current?.nickname ?? ''),
              ' 님 차례',
              h('br'),
              h(
                'span',
                { class: 'hint' },
                ahead > 0 ? `내 차례는 ${ahead}명 뒤` : m && m.seat >= 0 ? '' : '관전 중',
              ),
            )
          : h('span', {}, '준비하는 중이에요'),
      );
    }
    const left = rollsLeft();
    const btn = h(
      'button',
      { class: 'btn btn-primary', type: 'button', disabled: !canRoll(), 'data-testid': 'yt-roll' },
      left === 0 ? '굴리기 끝' : hasRolled() ? `다시 굴리기 (${left}번 남음)` : `굴리기 (${left}번 남음)`,
    );
    btn.addEventListener('click', roll);
    const pips = h(
      'div',
      { class: 'pips', 'aria-hidden': 'true' },
      ...[0, 1, 2].map((i) => h('i', { class: i < v.rollNo ? 'on' : '' })),
    );
    return h('div', { class: 'yt-roll' }, btn, pips);
  }

  function sheetView(): HTMLElement {
    const players = seated();
    const mine = myTurn() && hasRolled();
    const cell = (p: YachtPlayerView, cat: number): HTMLElement => {
      const val = p.scores[cat] ?? yacht.EMPTY;
      const isMe = p.id === snap.me;
      if (val !== yacht.EMPTY) return h('td', { class: isMe ? 'me' : '' }, String(val));
      if (isMe && mine) {
        const pts = points(cat);
        const b = h(
          'button',
          {
            type: 'button',
            class: `${sel === cat ? 'sel' : ''}${pts === 0 ? ' zero' : ''}`,
            'aria-pressed': String(sel === cat),
            'aria-label': `${yacht.CATEGORY_NAMES[cat]} ${pts}점`,
            'data-testid': `yt-cell-${cat}`,
          },
          String(pts),
        );
        b.addEventListener('click', () => {
          sel = cat;
          paint();
        });
        return h('td', { class: 'me' }, b);
      }
      return h('td', { class: isMe ? 'me' : '' }, '');
    };
    const row = (cat: number) =>
      h(
        'tr',
        {},
        h('th', { class: 'lab', scope: 'row' }, yacht.CATEGORY_NAMES[cat] ?? ''),
        ...players.map((p) => cell(p, cat)),
      );
    const upper = Array.from({ length: 6 }, (_, c) => c);
    const lower = Array.from({ length: 6 }, (_, c) => c + 6);
    return h(
      'section',
      { class: 'yt-sheet', 'aria-label': '점수표' },
      h(
        'table',
        {},
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { class: 'lab', scope: 'col' }, ''),
            ...players.map((p) =>
              h(
                'th',
                { class: p.id === snap.me ? 'me' : '', scope: 'col' },
                p.id === snap.me ? '나' : p.nickname,
              ),
            ),
          ),
        ),
        h(
          'tbody',
          {},
          ...upper.map(row),
          h(
            'tr',
            { class: 'sum' },
            h('th', { class: 'lab', scope: 'row' }, `위쪽 ${yacht.BONUS_THRESHOLD}↑`),
            ...players.map((p) => h('td', { class: p.id === snap.me ? 'me' : '' }, `${p.upperSum}`)),
          ),
          h(
            'tr',
            { class: 'sum' },
            h('th', { class: 'lab', scope: 'row' }, `보너스 +${yacht.BONUS_POINTS}`),
            ...players.map((p) =>
              h(
                'td',
                { class: `${p.id === snap.me ? 'me ' : ''}${p.bonus > 0 ? 'bonus' : ''}` },
                p.bonus > 0 ? `+${p.bonus}` : '-',
              ),
            ),
          ),
          ...lower.map(row),
          h(
            'tr',
            { class: 'total' },
            h('th', { class: 'lab', scope: 'row' }, '합계'),
            ...players.map((p) => h('td', { class: p.id === snap.me ? 'me' : '' }, String(p.total))),
          ),
        ),
      ),
    );
  }

  /** 기록 확인 막대 (시안 ①). 칸을 고르면 "N점 기록", 위쪽 칸으로 보너스에 닿으면 알려 준다 */
  function dockView(): HTMLElement | null {
    const m = me();
    if (!m || !myTurn() || !hasRolled()) return null;
    let label = '기록할 칸을 골라요';
    if (sel !== null) {
      const pts = points(sel);
      const reach =
        sel < 6 && m.upperSum < yacht.BONUS_THRESHOLD && m.upperSum + pts >= yacht.BONUS_THRESHOLD;
      label = `${yacht.CATEGORY_NAMES[sel]}에 ${pts}점 기록${reach ? ` (보너스 +${yacht.BONUS_POINTS}!)` : ''}`;
    }
    const b = h(
      'button',
      {
        class: 'btn btn-primary yt-confirm',
        type: 'button',
        disabled: sel === null,
        'data-testid': 'yt-record',
      },
      label,
    );
    b.addEventListener('click', record);
    return h('div', { class: 'yt-dock' }, b);
  }

  function resultView(): HTMLElement {
    const list = seated();
    const rank = yacht.ranks(list.map((p) => p.total));
    const rows = list
      .map((p, i) => ({ p, rank: rank[i] ?? 1 }))
      .sort((a, b) => a.rank - b.rank || a.p.seat - b.p.seat);
    const mine = rows.find((r) => r.p.id === snap.me);
    const joint = (r: number) => rows.filter((x) => x.rank === r).length > 1;
    const label = (r: number) => `${joint(r) ? '공동 ' : ''}${r}위`;
    const again = h('button', { class: 'btn btn-primary', type: 'button' }, '다시 하기');
    again.addEventListener('click', () => session.send('rematch', {}));
    const leave = h('button', { class: 'btn', type: 'button' }, '나가기');
    leave.addEventListener('click', onExit);
    const top = rows[0];
    return h(
      'div',
      { class: 'ud-result yt-result' },
      h(
        'section',
        { class: 'yt-hit', 'data-testid': 'result' },
        h(
          'p',
          { class: 't' },
          mine ? label(mine.rank) : `${top?.p.nickname ?? ''} 님 ${top ? label(top.rank) : ''}`,
        ),
        mine ? h('p', { class: 's' }, `합계 ${mine.p.total}점`) : null,
      ),
      h(
        'section',
        { class: 'yt-rank', 'aria-label': '순위' },
        ...rows.map((r) =>
          h(
            'div',
            { class: `row${r.rank === 1 ? ' first' : ''}` },
            h('span', { class: 'no' }, String(r.rank)),
            h('span', { class: 'nm' }, r.p.id === snap.me ? `${r.p.nickname} (나)` : r.p.nickname),
            r.rank === 1 ? h('span', { class: 'tag' }, joint(1) ? '공동 1위' : '1위') : null,
            h('span', { class: 'pt' }, `${r.p.total}점`),
          ),
        ),
      ),
      h('div', { class: 'result-actions' }, leave, again),
      sheetView(),
    );
  }

  function paint(): void {
    const v = snap.view;
    // 새 차례나 새 굴림이면 고정·선택을 정리한다
    if (v.turnId !== lastTurnId) {
      lastTurnId = v.turnId;
      keep = new Array<boolean>(yacht.DICE_COUNT).fill(false);
      sel = null;
    }
    if (v.rollNo !== lastRollNo) {
      if (v.rollNo > lastRollNo && v.rollNo > 0) rollingUntil = Date.now() + ROLL_ANIM_MS;
      lastRollNo = v.rollNo;
    }
    conn.replaceChildren(snap.connection === 'online' ? '' : svg(icons.offline));
    count.textContent =
      v.phase === 'PLAYING'
        ? `${Math.floor(v.turnsDone / Math.max(1, seated().length)) + 1}/${yacht.CATEGORY_COUNT}라운드`
        : '';
    if (v.phase === 'GAME_OVER') {
      body.className = 'yt-col over';
      body.replaceChildren(playersView(), resultView());
      return;
    }
    body.className = 'yt-col';
    const note = noteView();
    body.replaceChildren(
      playersView(),
      ...(note ? [note] : []),
      trayView(),
      sheetView(),
      ...(dockView() ? [dockView() as HTMLElement] : []),
    );
    tick();
  }

  function tick(): void {
    cancelAnimationFrame(raf);
    const v = snap.view;
    const timer = body.querySelector<HTMLElement>('[data-timer] i');
    if (timer && v.phase === 'PLAYING' && v.deadline > 0) {
      const left = Math.max(0, v.deadline - session.serverNow());
      timer.style.transform = `scaleX(${Math.min(1, left / (v.options.turnSeconds * 1000))})`;
      timer.parentElement?.classList.toggle('urgent', left <= URGENT_MS);
    }
    raf = requestAnimationFrame(tick);
  }

  const off = session.subscribe((s) => {
    snap = s;
    paint();
  });
  const noteTimer = window.setInterval(() => {
    if (snap.view.phase !== 'PLAYING') return;
    const old = body.querySelector('.yt-note');
    const next = noteView();
    if (Boolean(old) !== Boolean(next)) paint();
  }, 400);

  return () => {
    off();
    cancelAnimationFrame(raf);
    window.clearInterval(noteTimer);
    document.removeEventListener('keydown', onKey);
  };
}
