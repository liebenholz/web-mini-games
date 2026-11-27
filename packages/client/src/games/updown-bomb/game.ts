import { updown } from '@wmg/rules';
import { h, svg } from '../../dom.js';
import { bombSvg, icons } from '../../icons.js';
import type { UpdownCallView, UpdownPlayerView, UpdownSession, UpdownSnapshot } from './session.js';

const URGENT_MS = 5000;
/** 방금 말한 결과 알림을 보여 주는 시간 (시안 ②) */
const FLASH_MS = 1500;
/** 범위가 1~200이라 세 자리면 충분하다 */
const MAX_DIGITS = 3;

const RESULT_TEXT: Record<updown.CallResult, string> = { up: '업 ↑', down: '다운 ↓', bomb: '폭탄' };

/**
 * 업다운 숫자폭탄 게임 화면 (updown-bomb.md 8장, 시안 2026-11-27).
 * 남은 범위를 가장 크게, 아래에 숫자 키패드. 결과는 파티 게임 공통 "당첨 / 통과" (9장).
 * 키보드 숫자, Backspace, Enter로도 말할 수 있다.
 */
export function mountUpdownGame(root: HTMLElement, session: UpdownSession, onExit: () => void): () => void {
  let snap: UpdownSnapshot = session.snapshot;
  let entry = '';
  /** 이 차례에 이미 보냈다 */
  let sentTurnId = '';
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
  const shell = h('div', { class: 'ud' }, bar, body);
  root.replaceChildren(shell);

  function me(): UpdownPlayerView | undefined {
    return snap.view.players.find((p) => p.id === snap.me);
  }

  function seated(): UpdownPlayerView[] {
    return snap.view.players.filter((p) => p.seat >= 0).sort((a, b) => a.seat - b.seat);
  }

  function nameOf(id: string): string {
    return snap.view.players.find((p) => p.id === id)?.nickname ?? '';
  }

  function myTurn(): boolean {
    const v = snap.view;
    const m = me();
    return (
      v.phase === 'PLAYING' &&
      Boolean(m && m.seat >= 0) &&
      v.currentTurn === snap.me &&
      sentTurnId !== v.turnId
    );
  }

  function entryValue(): number | null {
    return entry === '' ? null : Number(entry);
  }

  function entryOk(): boolean {
    const n = entryValue();
    return n !== null && updown.isInRange(snap.view, n);
  }

  function type(d: string): void {
    if (!myTurn()) return;
    entry = (entry + d).replace(/^0+(?=\d)/, '').slice(0, MAX_DIGITS);
    paint();
  }

  function erase(): void {
    entry = entry.slice(0, -1);
    paint();
  }

  function submit(): void {
    if (!myTurn() || !entryOk()) return;
    const turnId = snap.view.turnId;
    sentTurnId = turnId;
    session.send('call_number', { value: entryValue() as number, turnId });
    entry = '';
    // 서버가 거절하면 차례가 그대로다. 잠시 뒤 다시 말할 수 있게 한다
    window.setTimeout(() => {
      if (sentTurnId === turnId && snap.view.turnId === turnId) {
        sentTurnId = '';
        paint();
      }
    }, 2000);
    paint();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[0-9]$/.test(e.key)) {
      type(e.key);
      e.preventDefault();
    } else if (e.key === 'Backspace') {
      erase();
      e.preventDefault();
    } else if (e.key === 'Enter' && entry !== '') {
      submit();
      e.preventDefault();
    }
  }
  document.addEventListener('keydown', onKey);

  // ───── 그리기 ─────

  function playersView(): HTMLElement {
    const v = snap.view;
    return h(
      'div',
      { class: 'ud-players', 'aria-label': '참가자' },
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
          tag ? h('span', { class: `ud-tag${tag === '끊김' ? ' off' : ''}` }, tag) : null,
          active ? h('span', { class: 'ud-t', 'data-timer': '' }, h('i')) : null,
        );
      }),
    );
  }

  function rangeView(): HTMLElement {
    const v = snap.view;
    const total = v.options.rangeMax;
    const pct = (n: number) => ((n - 1) / Math.max(1, total - 1)) * 100;
    const left = updown.remaining(v);
    const track = h(
      'div',
      { class: 'ud-track', 'aria-hidden': 'true' },
      h('span', {
        class: 'live',
        style: `left:${pct(v.low)}%;width:${Math.max(1.5, pct(v.high) - pct(v.low))}%`,
      }),
      ...v.history
        .filter((c) => c.result !== 'bomb')
        .map((c) => h('span', { class: `mk ${c.result}`, style: `left:calc(${pct(c.value)}% - 1px)` })),
    );
    return h(
      'section',
      { class: 'ud-range', 'aria-label': `남은 범위 ${v.low}부터 ${v.high}까지, ${left}개 남음` },
      h(
        'div',
        { class: 'lab' },
        h('span', {}, '남은 범위'),
        h('span', { 'data-testid': 'ud-left' }, `${left}개 남음`),
      ),
      h(
        'div',
        { class: 'nums', 'data-testid': 'ud-range' },
        String(v.low),
        h('span', { class: 'tilde', 'aria-hidden': 'true' }, '~'),
        String(v.high),
      ),
      track,
      h(
        'div',
        { class: 'ud-scale', 'aria-hidden': 'true' },
        h('span', {}, '1'),
        h('span', {}, String(total)),
      ),
    );
  }

  function inputView(): HTMLElement {
    const v = snap.view;
    if (!myTurn()) {
      const m = me();
      const current = v.players.find((p) => p.id === v.currentTurn);
      const n = seated().length;
      const ahead = m && current ? (m.seat - current.seat + n) % n : -1;
      const sub =
        !m || m.seat < 0 || ahead < 0 ? '관전 중' : ahead === 0 ? '보내는 중…' : `내 차례는 ${ahead}명 뒤`;
      return h(
        'div',
        { class: 'ud-wait', role: 'status' },
        h(
          'div',
          {},
          v.phase === 'STARTING'
            ? h('b', {}, '곧 시작합니다')
            : h('span', {}, h('b', {}, current?.nickname ?? ''), ' 님이 고르는 중'),
          h('br'),
          h('span', { class: 'hint' }, v.phase === 'STARTING' ? '폭탄 숫자를 숨기는 중이에요' : sub),
        ),
      );
    }
    const bad = entry !== '' && !entryOk();
    const keys = h(
      'div',
      { class: 'ud-keys' },
      ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((d) => {
        const b = h('button', { class: 'ud-key', type: 'button', 'data-key': d }, d);
        b.addEventListener('click', () => type(d));
        return b;
      }),
    );
    const clear = h('button', { class: 'btn', type: 'button' }, '지우기');
    clear.addEventListener('click', erase);
    const call = h(
      'button',
      { class: 'btn btn-primary', type: 'button', disabled: !entryOk(), 'data-testid': 'ud-call' },
      '말하기',
    );
    call.addEventListener('click', submit);
    return h(
      'div',
      { class: 'ud-input' },
      h(
        'div',
        {
          class: `ud-val${bad ? ' bad' : ''}${entry ? '' : ' empty'}`,
          'aria-live': 'polite',
          'data-testid': 'ud-entry',
        },
        entry || '숫자를 누르세요',
      ),
      h(
        'p',
        { class: `ud-hint${bad ? ' bad' : ''}` },
        bad
          ? `${v.low}~${v.high} 사이 숫자만 말할 수 있어요`
          : `${v.low}~${v.high} 사이 · 숫자키와 Enter로도 돼요`,
      ),
      keys,
      h('div', { class: 'ud-actions' }, clear, call),
    );
  }

  function callRow(c: UpdownCallView, fresh: boolean): HTMLElement {
    return h(
      'li',
      { class: `ud-row${fresh ? ' fresh' : ''}` },
      h('span', { class: 'who' }, c.playerId === snap.me ? `${nameOf(c.playerId)} (나)` : nameOf(c.playerId)),
      c.isAuto ? h('span', { class: 'ud-auto' }, '대신') : null,
      h('span', { class: 'n' }, String(c.value)),
      h('span', { class: `res ${c.result}` }, RESULT_TEXT[c.result]),
    );
  }

  function logView(): HTMLElement {
    const rows = [...snap.view.history].reverse();
    return h(
      'section',
      { class: 'ud-log', 'aria-label': '기록' },
      h('h3', {}, '기록'),
      rows.length === 0
        ? h('p', { class: 'hint' }, '아직 아무도 말하지 않았어요')
        : h('ol', { 'data-testid': 'ud-log' }, ...rows.map((c, i) => callRow(c, i === 0))),
    );
  }

  /** 알림 줄: 방금 결과(1.5초) 또는 나의 대신 말하기, 다른 사람 이탈·끊김 */
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
            ? `봇이 대신 말하고 있어요 (${f.value}). 직접 말하면 돌려받아요`
            : `시간이 지나 대신 말했어요 (${f.value}). 한 번 더 지나면 봇이 이어서 해요`,
        ),
      );
    if (f && now - f.at < FLASH_MS && f.result !== 'bomb')
      return h(
        'div',
        { class: `ud-flash ${f.result}`, role: 'status' },
        svg(f.result === 'up' ? icons.arrowUp : icons.arrowDown),
        h('span', {}, `${nameOf(f.playerId)} · ${f.value} → `, h('b', {}, f.result === 'up' ? '업' : '다운')),
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
          `${n.nickname} 님 연결 끊김 · 시간이 지나면 대신 말해요`,
        );
    }
    return null;
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
          h('div', { class: 'ud-bomb-wrap' }, svg(bombSvg())),
          h('div', { class: 'ud-bombnum' }, String(v.bomb)),
          h('p', { class: 'title' }, '당첨!'),
          h(
            'p',
            { class: 'sub' },
            v.forced ? '남은 숫자가 폭탄뿐이었어요' : `폭탄 숫자 ${v.bomb}를 말했어요`,
          ),
        )
      : h(
          'section',
          { class: `ud-hit pass`, 'data-testid': 'result' },
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
            ' 님 당첨 · 폭탄 숫자 ',
            h('b', { class: 'bombtext' }, String(v.bomb)),
            v.forced ? ' (남은 숫자가 폭탄뿐)' : '',
          ),
        );
    return h(
      'div',
      { class: 'ud-result' },
      card,
      h('p', { class: 'ud-sum' }, `${v.history.length}번 만에 · 범위 1~${v.options.rangeMax}`),
      h('div', { class: 'result-actions' }, leave, again),
      logView(),
    );
  }

  function paint(): void {
    const v = snap.view;
    conn.replaceChildren(snap.connection === 'online' ? '' : svg(icons.offline));
    count.textContent = v.phase === 'PLAYING' ? `${v.history.length + 1}번째` : '';
    if (v.phase === 'GAME_OVER') {
      body.className = 'ud-body over';
      body.replaceChildren(resultView());
      return;
    }
    body.className = 'ud-body';
    // 알림 줄 자리는 늘 남겨 둔다. 생겼다 사라질 때 범위와 키패드가 출렁이지 않게
    const slot = h('div', { class: 'ud-flash-slot' }, flashView() ?? '');
    const main = h('div', { class: 'ud-col main' }, slot, rangeView(), inputView());
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

  let lastTurnId = '';
  const off = session.subscribe((s) => {
    snap = s;
    if (sentTurnId && s.view.turnId !== sentTurnId) sentTurnId = '';
    if (s.view.turnId !== lastTurnId) {
      lastTurnId = s.view.turnId;
      entry = '';
    }
    paint();
  });
  // 알림 줄을 제때 지운다
  const flashTimer = window.setInterval(() => {
    if (snap.view.phase === 'PLAYING') {
      const slot = body.querySelector('.ud-flash-slot');
      const f = flashView();
      if (slot && Boolean(slot.firstElementChild) !== Boolean(f)) slot.replaceChildren(f ?? '');
    }
  }, 300);

  return () => {
    off();
    cancelAnimationFrame(raf);
    window.clearInterval(flashTimer);
    document.removeEventListener('keydown', onKey);
  };
}
