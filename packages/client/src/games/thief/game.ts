import { thief } from '@wmg/rules';
import { h, svg } from '../../dom.js';
import { icons } from '../../icons.js';
import type { ThiefPlayerView, ThiefSession, ThiefSnapshot } from './session.js';

const URGENT_MS = 5000;
const FLASH_MS = 3500;
const TIGHT_FROM = 7;
const SYMBOL: Record<thief.Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

/** 카드 한 장 (앞면). 원카드와 같은 oc-card 틀을 쓴다 */
function cardFace(card: string, extra = ''): HTMLElement {
  if (thief.isJoker(card))
    return h(
      'span',
      { class: `oc-card joker color ${extra}`, 'data-card': card, role: 'img', 'aria-label': '조커' },
      h('span', { class: 'oc-corner' }, '조커'),
      h('span', { class: 'oc-pip', 'aria-hidden': 'true' }, '★'),
    );
  const s = thief.suitOf(card) as thief.Suit;
  const r = thief.rankOf(card) ?? '';
  return h(
    'span',
    {
      class: `oc-card ${s === 'H' || s === 'D' ? 'red' : 'black'} ${extra}`,
      'data-card': card,
      role: 'img',
      'aria-label': `${r} ${SYMBOL[s]}`,
    },
    h('span', { class: 'oc-corner' }, `${r}${SYMBOL[s]}`),
    h('span', { class: 'oc-pip', 'aria-hidden': 'true' }, SYMBOL[s]),
  );
}

/** 숫자 순(A=1) → 모양 순, 조커는 맨 뒤 (보기 정렬일 뿐이다, TF-06) */
function sorted(cards: readonly string[]): string[] {
  const key = (c: string) =>
    thief.isJoker(c)
      ? 999
      : thief.RANKS.indexOf(thief.rankOf(c) as thief.Rank) * 4 +
        thief.SUITS.indexOf(thief.suitOf(c) as thief.Suit);
  return [...cards].sort((a, b) => key(a) - key(b));
}

/**
 * 도둑잡기 게임 화면 (thief.md 7장, 시안 2026-11-28).
 * 키보드: ←→ = 뽑을 카드 선택, Enter 또는 Space = 뽑기
 */
export function mountThiefGame(root: HTMLElement, session: ThiefSession, onExit: () => void): () => void {
  let snap: ThiefSnapshot = session.snapshot;
  let raf = 0;
  let sel: number | null = null;
  let lastTurnId = '';

  const exit = h('button', { class: 'btn btn-ghost back-link', type: 'button' }, svg(icons.back), '나가기');
  exit.addEventListener('click', () => {
    const playing = snap.view.phase === 'PLAYING' && (me()?.seat ?? -1) >= 0 && !me()?.out;
    if (!playing || confirm('게임에서 나갈까요? 봇이 이어서 합니다.')) onExit();
  });
  const conn = h('span', { class: 'hint' });
  const count = h('span', { class: 'ud-count' });
  const bar = h('header', { class: 'statusbar ud-bar' }, exit, conn, count);
  const body = h('div', { class: 'yt-col' });
  root.replaceChildren(h('div', { class: 'ud' }, bar, body));

  function me(): ThiefPlayerView | undefined {
    return snap.view.players.find((p) => p.id === snap.me);
  }

  function seated(): ThiefPlayerView[] {
    return snap.view.players.filter((p) => p.seat >= 0).sort((a, b) => a.seat - b.seat);
  }

  const byId = (id: string) => snap.view.players.find((p) => p.id === id);
  const nameOf = (id: string) => byId(id)?.nickname ?? '';

  function myTurn(): boolean {
    const v = snap.view;
    const m = me();
    return v.phase === 'PLAYING' && Boolean(m && m.seat >= 0 && !m.out) && v.currentTurn === snap.me;
  }

  const targetCount = () => byId(snap.view.targetId)?.handCount ?? 0;

  function draw(): void {
    if (!myTurn() || sel === null || sel >= targetCount()) return;
    session.send('draw', { index: sel, turnId: snap.view.turnId });
    sel = null;
  }

  function move(dir: 1 | -1): void {
    const n = targetCount();
    if (!myTurn() || n === 0) return;
    sel = sel === null ? (dir === 1 ? 0 : n - 1) : (sel + dir + n) % n;
    paint();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter')) return;
    if (e.key === 'ArrowRight') {
      move(1);
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      move(-1);
      e.preventDefault();
    } else if (e.key === 'Enter' || e.key === ' ') {
      draw();
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
            class: `yt-p tf-p${active ? ' active' : ''}${p.out && v.phase === 'PLAYING' ? ' out' : ''}${p.id === snap.me ? ' me' : ''}`,
            'aria-current': active ? 'true' : null,
            'data-testid': `tf-chip-${p.seat}`,
          },
          h(
            'span',
            { class: `avatar tone-${(p.seat % 6) + 1}`, 'aria-hidden': 'true' },
            p.id === snap.me ? '나' : ([...p.nickname][0] ?? ''),
          ),
          h('span', { class: 'nm' }, p.nickname),
          tag ? h('span', { class: `ud-tag${tag === '끊김' ? ' off' : ''}` }, tag) : null,
          p.out && v.phase === 'PLAYING'
            ? h('span', { class: 'tf-out' }, '안전')
            : h('span', { class: 'tot' }, `${p.handCount}장`),
          active ? h('span', { class: 't', 'data-timer': '' }, h('i')) : null,
        );
      }),
    );
  }

  function noteView(): HTMLElement | null {
    const v = snap.view;
    if (v.phase === 'STARTING') return h('div', { class: 'tf-flash', role: 'status' }, '곧 시작합니다');
    const f = snap.flash;
    const now = Date.now();
    if (f && now - f.at < FLASH_MS) {
      if (f.isAuto && f.toId === snap.me)
        return h(
          'div',
          { class: 'tf-flash', role: 'status' },
          svg(icons.robot),
          me()?.autopilot
            ? '봇이 대신 뽑고 있어요. 직접 뽑으면 돌려받아요'
            : '시간이 지나 대신 뽑았어요. 한 번 더 지나면 봇이 이어서 해요',
        );
      return h(
        'div',
        { class: 'tf-flash', role: 'status' },
        `${nameOf(f.toId)} 님이 ${nameOf(f.fromId)} 님에게서 뽑았어요 · ${f.matched ? `${f.matched} 짝!` : '짝이 안 맞았어요'}${f.isAuto ? ' (대신)' : ''}`,
      );
    }
    const n = snap.notice;
    if (n && n.playerId !== snap.me) {
      const p = byId(n.playerId);
      if (n.reason === 'left' && now - n.at < 8000)
        return h(
          'div',
          { class: 'tf-flash', role: 'status' },
          svg(icons.robot),
          `${n.nickname} 님이 나가서 봇이 이어서 해요`,
        );
      if (n.reason === 'disconnected' && p && !p.connected)
        return h(
          'div',
          { class: 'tf-flash', role: 'status' },
          svg(icons.wifiOff),
          `${n.nickname} 님 연결 끊김`,
        );
    }
    if (myTurn()) return h('div', { class: 'tf-flash', role: 'status' }, '내 차례예요. 카드를 골라 뽑아요');
    return null;
  }

  function pairsView(): HTMLElement {
    return h(
      'div',
      { class: 'tf-pairs', 'aria-label': '내려놓은 짝' },
      h('b', {}, '내려놓은 짝'),
      ...(snap.view.pairs.length === 0
        ? [h('span', {}, '아직 없어요')]
        : snap.view.pairs.map((r) => h('span', { class: 'tf-pair' }, r))),
    );
  }

  function targetView(): HTMLElement {
    const v = snap.view;
    const target = byId(v.targetId);
    const drawer = byId(v.currentTurn);
    const mine = myTurn();
    const n = target?.handCount ?? 0;
    const title = mine
      ? `${target?.nickname ?? ''} 님의 패에서 한 장 뽑아요`
      : target?.id === snap.me
        ? `${drawer?.nickname ?? ''} 님이 나에게서 뽑는 중이에요`
        : v.phase === 'STARTING'
          ? '곧 시작합니다'
          : `${drawer?.nickname ?? ''} 님이 ${target?.nickname ?? ''} 님에게서 뽑는 중이에요`;
    const backs = Array.from({ length: n }, (_, i) => {
      const b = h(
        'button',
        {
          class: `tf-back${sel === i ? ' sel' : ''}`,
          type: 'button',
          disabled: !mine,
          'aria-pressed': mine ? String(sel === i) : null,
          'aria-label': `${i + 1}번 카드`,
          'data-testid': `tf-back-${i}`,
        },
        h('span', {}, String(i + 1)),
      );
      b.addEventListener('click', () => {
        sel = i;
        paint();
      });
      return b;
    });
    return h(
      'section',
      { class: 'tf-target', 'aria-label': '뽑을 패' },
      h(
        'h3',
        {},
        target
          ? h(
              'span',
              { class: `avatar tone-${(target.seat % 6) + 1}`, 'aria-hidden': 'true' },
              [...target.nickname][0] ?? '',
            )
          : null,
        title,
      ),
      h('div', { class: 'tf-backs' }, ...backs),
      h('div', { class: 'tf-gap' }),
    );
  }

  function handView(): HTMLElement {
    const m = me();
    const cards = sorted(snap.hand);
    const played = Boolean(m && m.seat >= 0);
    return h(
      'section',
      { class: 'tf-hand-wrap', 'aria-label': '내 패' },
      h(
        'h3',
        {},
        h('span', {}, played ? `내 패 · ${cards.length}장` : '관전 중'),
        h('span', { class: 'hint' }, '숫자 순 정렬'),
      ),
      played && m?.out
        ? h('p', { class: 'hint tf-safe' }, '패를 다 내려놓았어요. 안전해요!')
        : h(
            'div',
            { class: `tf-hand${cards.length >= TIGHT_FROM ? ' tight' : ''}`, 'data-testid': 'tf-hand' },
            ...cards.map((c) => cardFace(c, thief.isJoker(c) ? 'joker-hl' : '')),
          ),
    );
  }

  function waitView(): HTMLElement | null {
    const v = snap.view;
    const m = me();
    if (myTurn() || v.phase !== 'PLAYING' || !m || m.seat < 0 || m.out) return null;
    const n = seated().filter((p) => !p.out);
    const cur = n.findIndex((p) => p.id === v.currentTurn);
    const mine = n.findIndex((p) => p.id === snap.me);
    const ahead = cur >= 0 && mine >= 0 ? (mine - cur + n.length) % n.length : -1;
    return h(
      'div',
      { class: 'yt-wait tf-wait', role: 'status' },
      ahead > 0 ? h('span', {}, '내 차례는 ', h('b', {}, `${ahead}명 뒤`), '예요') : '곧 내 차례예요',
    );
  }

  function dockView(): HTMLElement | null {
    if (!myTurn()) return null;
    const b = h(
      'button',
      {
        class: 'btn btn-primary yt-confirm',
        type: 'button',
        disabled: sel === null,
        'data-testid': 'tf-draw',
      },
      sel === null ? '뽑을 카드를 골라요' : `${sel + 1}번 카드 뽑기`,
    );
    b.addEventListener('click', draw);
    return h('div', { class: 'yt-dock' }, b);
  }

  function resultView(): HTMLElement {
    const v = snap.view;
    const loser = byId(v.loserId);
    const m = me();
    const played = Boolean(m && m.seat >= 0);
    const hit = v.loserId === snap.me;
    const again = h('button', { class: 'btn btn-primary', type: 'button' }, '다시 하기');
    again.addEventListener('click', () => session.send('rematch', {}));
    const leave = h('button', { class: 'btn', type: 'button' }, '나가기');
    leave.addEventListener('click', onExit);
    const card = hit
      ? h(
          'section',
          { class: 'tf-hit', 'data-testid': 'result' },
          cardFace(thief.JOKER, 'big'),
          h('p', { class: 't' }, '당첨!'),
          h('p', { class: 's' }, '조커를 끝까지 들고 있었어요'),
        )
      : h(
          'section',
          { class: 'tf-hit pass', 'data-testid': 'result' },
          h('p', { class: 't' }, played ? '통과!' : `${loser?.nickname ?? ''} 님 당첨`),
          h('p', { class: 's' }, h('b', {}, loser?.nickname ?? ''), ' 님이 조커를 끝까지 들고 있었어요'),
        );
    const rows = [...seated()].sort((a, b) => a.outOrder - b.outOrder);
    return h(
      'div',
      { class: 'ud-result yt-result' },
      card,
      h(
        'section',
        { class: 'tf-final', 'aria-label': '결과' },
        ...rows.map((p) =>
          h(
            'div',
            { class: `row${p.id === v.loserId ? ' lose' : ''}` },
            h('span', { class: 'nm' }, p.id === snap.me ? `${p.nickname} (나)` : p.nickname),
            h('span', { class: 'tag' }, p.id === v.loserId ? '당첨' : `안전 ${p.outOrder}번째`),
            h('span', { class: 'cards' }, ...p.finalHand.map((c) => cardFace(c))),
          ),
        ),
      ),
      h('p', { class: 'hint tf-sum' }, `뽑기 ${v.draws}번`),
      h('div', { class: 'result-actions' }, leave, again),
    );
  }

  function paint(): void {
    const v = snap.view;
    if (v.turnId !== lastTurnId) {
      lastTurnId = v.turnId;
      sel = null;
    }
    if (sel !== null && sel >= targetCount()) sel = null;
    conn.replaceChildren(snap.connection === 'online' ? '' : svg(icons.offline));
    count.textContent = v.phase === 'PLAYING' ? `뽑기 ${v.draws + 1}번째` : '';
    if (v.phase === 'GAME_OVER') {
      body.className = 'yt-col over';
      body.replaceChildren(playersView(), resultView());
      return;
    }
    body.className = 'yt-col';
    const note = noteView();
    const wait = waitView();
    const dock = dockView();
    body.replaceChildren(
      playersView(),
      ...(note ? [note] : []),
      pairsView(),
      targetView(),
      handView(),
      ...(wait ? [wait] : []),
      ...(dock ? [dock] : []),
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
    const old = body.querySelector('.tf-flash');
    if (Boolean(old) !== Boolean(noteView())) paint();
  }, 400);

  return () => {
    off();
    cancelAnimationFrame(raf);
    window.clearInterval(noteTimer);
    document.removeEventListener('keydown', onKey);
  };
}
