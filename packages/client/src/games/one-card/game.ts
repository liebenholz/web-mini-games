import { oneCard } from '@wmg/rules';
import { h, svg, toast } from '../../dom.js';
import { icons } from '../../icons.js';
import { avatar } from '../../screens/avatar.js';
import { cardFace, cardName, playHint, suitName, suitSymbol } from './cards.js';
import type { OneCardPlayerView, OneCardSession, OneCardSnapshot } from './session.js';

const URGENT_MS = 5000;
/** 판정 결과 알림을 보여 주는 시간 */
const CALL_NOTICE_MS = 3500;
const CARD_W = 52;

/**
 * 원카드 게임 화면 (one-card.md 11장, 시안 1~4).
 * 위: 상대(이름, 패 장수, 차례), 가운데: 덱·맨 위 카드·조건·공격·타이머, 아래: 내 패(부채꼴) + 가져오기.
 * 원카드 창이 열리면 가운데에 큰 버튼, 7을 내면 모양 고르기 시트를 띄운다.
 */
export function mountOneCardGame(root: HTMLElement, session: OneCardSession, onExit: () => void): () => void {
  let snap: OneCardSnapshot = session.snapshot;
  let pressedWindow = '';
  let raf = 0;

  const exit = h('button', { class: 'btn btn-ghost back-link', type: 'button' }, svg(icons.back), '나가기');
  exit.addEventListener('click', () => {
    const playing = snap.view.phase === 'PLAYING' && me()?.status === 'playing';
    if (!playing || confirm('게임에서 나갈까요? 봇이 이어서 합니다.')) onExit();
  });
  const conn = h('span', { class: 'hint' });
  const direction = h('span', { class: 'oc-direction', 'data-testid': 'direction' });
  const statusbar = h('header', { class: 'statusbar oc-bar' }, exit, conn, direction);

  const notice = h('div', { class: 'oc-notice', role: 'status', 'aria-live': 'polite', hidden: true });
  const opponents = h('div', { class: 'oc-opps', 'data-testid': 'opponents' });
  const deck = h('div', { class: 'oc-deck', 'aria-label': '덱' });
  const top = h('div', { class: 'oc-top', 'data-testid': 'top-card' });
  const meta = h('div', { class: 'oc-meta', 'data-testid': 'table-meta' });
  const timer = h('div', { class: 'oc-timer', 'data-timer': '' }, h('i'));
  const center = h(
    'section',
    { class: 'oc-center', 'aria-label': '테이블' },
    h('div', { class: 'oc-pile' }, deck, top),
    meta,
    timer,
  );
  const hand = h('div', { class: 'oc-hand', role: 'group', 'aria-label': '내 패', 'data-testid': 'oc-hand' });
  const drawBtn = h(
    'button',
    { class: 'btn btn-block', type: 'button', 'data-testid': 'oc-draw' },
    '가져오기',
  );
  const passBtn = h(
    'button',
    { class: 'btn btn-block', type: 'button', 'data-testid': 'oc-pass', hidden: true },
    '넘기기',
  );
  const actions = h('div', { class: 'oc-actions' }, drawBtn, passBtn);
  // 내 패 장수 (폰에서 겹친 카드만으로는 세기 어렵다)
  const myCount = h('span', { class: 'oc-my-count', 'data-testid': 'my-count', 'aria-live': 'polite' });
  const handHead = h(
    'div',
    { class: 'oc-hand-head' },
    h('span', { class: 'oc-hand-title' }, '내 패'),
    myCount,
  );
  const mine = h('section', { class: 'oc-mine' }, handHead, hand, actions);

  const callBtn = h('button', {
    class: 'oc-call',
    type: 'button',
    'data-testid': 'oc-one-card',
    hidden: true,
  });
  const sheetSlot = h('div');
  const result = h('div', { class: 'gomoku-result oc-result', hidden: true, 'data-testid': 'result' });
  const shell = h(
    'div',
    { class: 'oc' },
    statusbar,
    notice,
    opponents,
    center,
    mine,
    callBtn,
    sheetSlot,
    result,
  );
  root.replaceChildren(shell);

  drawBtn.addEventListener('click', () => {
    if (!canAct()) return;
    session.send('draw', { turnId: snap.view.turnId });
  });
  passBtn.addEventListener('click', () => {
    if (!canAct()) return;
    session.send('pass', { turnId: snap.view.turnId });
  });
  callBtn.addEventListener('click', () => {
    const id = snap.view.windowId;
    if (!id) return;
    pressedWindow = id;
    session.send('call_one_card', { windowId: id });
    paint();
  });

  function me(): OneCardPlayerView | undefined {
    return snap.view.players.find((p) => p.id === snap.me);
  }

  function seated(): OneCardPlayerView[] {
    return snap.view.players.filter((p) => !p.spectator && p.seat >= 0).sort((a, b) => a.seat - b.seat);
  }

  function myTurn(): boolean {
    const v = snap.view;
    return v.phase === 'PLAYING' && !v.windowId && v.currentTurn === snap.me && me()?.status === 'playing';
  }

  function canAct(): boolean {
    return myTurn() && Boolean(snap.view.turnId);
  }

  function playView(): oneCard.PlayView {
    const v = snap.view;
    return {
      discard: v.topCard ? [v.topCard] : [],
      chosenSuit: v.chosenSuit || null,
      attack: v.attack,
      drawn: snap.drawn,
    };
  }

  function playable(card: string): boolean {
    return canAct() && Boolean(snap.view.topCard) && oneCard.canPlayCard(playView(), card);
  }

  function play(card: string): void {
    if (!playable(card)) {
      if (canAct()) toast('지금 낼 수 없는 카드예요.');
      return;
    }
    if (oneCard.rankOf(card) === '7') {
      openSuitSheet(card);
      return;
    }
    session.send('play', { card, turnId: snap.view.turnId });
  }

  /** 시안 4: 7을 내면 다음 모양 고르기 (C-12) */
  function openSuitSheet(card: string): void {
    const turnId = snap.view.turnId;
    const close = () => sheetSlot.replaceChildren();
    const buttons = oneCard.SUITS.map((s) => {
      const b = h(
        'button',
        {
          class: `oc-suit ${s === 'H' || s === 'D' ? 'red' : 'black'}`,
          type: 'button',
          'aria-label': suitName(s),
          'data-testid': `suit-${s}`,
        },
        suitSymbol(s),
      );
      b.addEventListener('click', () => {
        close();
        if (snap.view.turnId === turnId) session.send('play', { card, suit: s, turnId });
      });
      return b;
    });
    const cancel = h('button', { class: 'btn btn-block', type: 'button' }, '취소');
    cancel.addEventListener('click', close);
    const backdrop = h(
      'div',
      { class: 'oc-sheet-backdrop' },
      h(
        'div',
        { class: 'oc-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': '다음 모양 고르기' },
        h('strong', {}, '다음 모양 고르기'),
        h('div', { class: 'oc-suits' }, ...buttons),
        cancel,
      ),
    );
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });
    sheetSlot.replaceChildren(backdrop);
    buttons[0]?.focus();
  }

  /** 상대: 내 다음 자리부터 진행 순서대로 */
  function drawOpponents(): void {
    const v = snap.view;
    const all = seated();
    const mySeat = me()?.seat ?? -1;
    const others = all.filter((p) => p.id !== snap.me);
    if (mySeat >= 0)
      others.sort(
        (a, b) =>
          ((a.seat - mySeat + all.length) % all.length) - ((b.seat - mySeat + all.length) % all.length),
      );
    opponents.replaceChildren(
      ...others.map((p) => {
        const active = v.phase === 'PLAYING' && (v.currentTurn === p.id || v.windowTarget === p.id);
        const backs = h(
          'span',
          { class: 'oc-backs', 'aria-hidden': 'true' },
          ...Array.from({ length: Math.min(p.handCount, 6) }, () => h('i')),
        );
        const state =
          p.status === 'finished'
            ? h('span', { class: 'oc-tag done' }, `${p.rank}위`)
            : p.status === 'bankrupt'
              ? h('span', { class: 'oc-tag out' }, '파산')
              : p.handCount === 1
                ? h('span', { class: 'oc-tag one' }, '1장')
                : null;
        const extra = p.replaced
          ? h('span', { class: 'oc-sub' }, '봇이 대신')
          : !p.connected
            ? h('span', { class: 'oc-sub off' }, '연결 끊김')
            : p.autopilot
              ? h('span', { class: 'oc-sub' }, '자동 진행')
              : null;
        return h(
          'div',
          {
            class: `oc-opp${active ? ' active' : ''}${p.status && p.status !== 'playing' ? ' out' : ''}`,
            'data-player': p.id,
            'aria-label': `${p.nickname} ${p.handCount}장${active ? ', 차례' : ''}`,
          },
          avatar(p, p.seat),
          h('span', { class: 'oc-name' }, p.nickname, state),
          backs,
          h('span', { class: 'oc-count' }, `${p.handCount}장`),
          extra,
        );
      }),
    );
  }

  function drawCenter(): void {
    const v = snap.view;
    deck.replaceChildren(h('span', {}, `${v.deckCount}장`));
    top.replaceChildren(v.topCard ? cardFace(v.topCard, 'big') : h('span', { class: 'oc-card empty' }));
    top.setAttribute('aria-label', v.topCard ? `맨 위 카드 ${cardName(v.topCard)}` : '맨 위 카드 없음');
    const pills: HTMLElement[] = [];
    if (v.phase === 'PLAYING') {
      if (v.windowId) {
        pills.push(h('span', { class: 'oc-pill' }, '원카드 판정 중 · 다음 차례 대기'));
      } else {
        const turnName = v.players.find((p) => p.id === v.currentTurn)?.nickname ?? '';
        pills.push(
          h(
            'span',
            { class: `oc-pill${myTurn() ? ' mine' : ''}` },
            myTurn() ? '내 차례' : `${turnName} 님 차례`,
          ),
        );
        if (v.attack > 0)
          pills.push(h('span', { class: 'oc-pill atk', 'data-testid': 'attack' }, `+${v.attack}장 공격`));
        if (v.chosenSuit)
          pills.push(h('span', { class: 'oc-pill' }, `고른 모양 ${suitSymbol(v.chosenSuit)}`));
        if (myTurn())
          pills.push(h('span', { class: 'oc-pill' }, playHint(v.topCard, v.chosenSuit, v.attack)));
      }
    }
    meta.replaceChildren(...pills);
    direction.textContent = v.direction === -1 ? '↺ 반대 방향' : '↻ 시계 방향';
  }

  /** 내 패: 겹친 부채꼴. 360px에서 20장이어도 한 장씩 누를 수 있게 간격을 줄인다 */
  function drawHand(): void {
    const m = me();
    if (!m || m.seat < 0 || snap.role === 'spectator') {
      hand.replaceChildren(h('p', { class: 'hint oc-watch' }, '관전 중이에요'));
      actions.hidden = true;
      handHead.hidden = true;
      return;
    }
    handHead.hidden = false;
    const count = snap.hand.length;
    myCount.textContent = count === 1 ? '1장 남음!' : `${count}장`;
    myCount.classList.toggle('one', count === 1);
    myCount.classList.toggle('many', count >= 15);
    actions.hidden = false;
    const cards = [...snap.hand];
    const width = Math.max(240, hand.clientWidth || 328);
    const n = cards.length;
    // 폰 폭에서는 카드가 34px씩 보이게 겹친다. 넓은 화면(데스크톱)에서는 자리가 남으므로 거의 다 보이게 펼친다
    const maxStep = width >= 480 ? CARD_W - 6 : 34;
    const step = n > 1 ? Math.min(maxStep, (width - CARD_W) / (n - 1)) : 0;
    const used = CARD_W + step * Math.max(0, n - 1);
    const start = (width - used) / 2;
    const fan = n <= 9;
    const turn = canAct();
    hand.replaceChildren(
      ...cards.map((card, i) => {
        const ok = turn && playable(card);
        const offset = i - (n - 1) / 2;
        const b = h(
          'button',
          {
            class: `oc-hand-card${turn ? (ok ? ' up' : ' dim') : ''}`,
            type: 'button',
            'data-card': card,
            'aria-label': `${cardName(card)}${ok ? ', 낼 수 있음' : ''}`,
            style: `left:${start + i * step}px;${fan ? `transform:rotate(${offset * 3}deg) translateY(${Math.abs(offset) * 1.5}px)` : ''}`,
          },
          cardFace(card),
        );
        b.addEventListener('click', () => play(card));
        return b;
      }),
    );
    if (n === 0)
      hand.append(
        h(
          'p',
          { class: 'hint oc-watch' },
          m.status === 'finished' ? `다 냈어요 · ${m.rank}위` : m.status === 'bankrupt' ? '파산했어요' : '',
        ),
      );
    const v = snap.view;
    const drawn = snap.drawn !== null && turn;
    drawBtn.hidden = drawn;
    passBtn.hidden = !drawn;
    drawBtn.disabled = !turn;
    passBtn.disabled = !turn;
    drawBtn.classList.toggle('btn-danger', turn && v.attack > 0);
    drawBtn.textContent = turn && v.attack > 0 ? `+${v.attack}장 받기` : '가져오기';
    if (m.status !== 'playing') actions.hidden = true;
  }

  /** 시안 3: 원카드 창. 판에 남아 있는 사람은 누구나 누를 수 있다 (C-30) */
  function drawCall(): void {
    const v = snap.view;
    const m = me();
    const show =
      v.phase === 'PLAYING' && Boolean(v.windowId) && m?.status === 'playing' && pressedWindow !== v.windowId;
    callBtn.hidden = !show;
    if (!show) return;
    const target = v.players.find((p) => p.id === v.windowTarget);
    callBtn.replaceChildren(
      h('span', { class: 'oc-call-title' }, '원카드!'),
      h(
        'small',
        {},
        v.windowTarget === snap.me
          ? '먼저 누르면 안전해요'
          : `먼저 누르면 ${target?.nickname ?? ''} 님이 1장 받아요`,
      ),
    );
  }

  function drawNotice(): void {
    const v = snap.view;
    let text = '';
    let kind = '';
    const c = snap.call;
    const n = snap.notice;
    const name = (id: string | null) => v.players.find((p) => p.id === id)?.nickname ?? '';
    // 판이 끝나면 결과 화면 위에 지난 알림("○○ 님 원카드!")을 남기지 않는다
    if (v.phase === 'GAME_OVER') {
      // 알림 없음
    } else if (c && Date.now() - c.at < CALL_NOTICE_MS) {
      if (c.result === 'penalty') {
        text =
          c.playerId === snap.me
            ? `${name(c.callerId)} 님이 먼저 눌렀어요! 1장 받았어요`
            : `${name(c.callerId)} 님이 먼저 눌러 ${name(c.playerId)} 님이 1장 받았어요`;
        kind = 'off';
      } else if (c.result === 'safe') {
        text = `${name(c.playerId)} 님 원카드!`;
        kind = 'ok';
      } else {
        text = `${name(c.playerId)} 님 1장 남음`;
        kind = 'bot';
      }
    } else if (n && v.phase === 'PLAYING' && n.playerId !== snap.me) {
      const p = v.players.find((x) => x.id === n.playerId);
      const age = Date.now() - n.at;
      if (n.reason === 'left' && age < 8000) {
        text = `${n.nickname} 님이 나가서 봇이 이어서 합니다.`;
        kind = 'bot';
      } else if (n.reason === 'disconnected' && p && !p.connected) {
        text = `${n.nickname} 님 연결 끊김 · 차례가 오면 자동으로 진행돼요`;
        kind = 'off';
      } else if (n.reason === 'returned' && age < 4000) {
        text = `${n.nickname} 님이 다시 연결됐어요.`;
        kind = 'ok';
      }
    }
    notice.className = `oc-notice gomoku-notice ${kind}`;
    notice.hidden = !text;
    notice.textContent = text;
  }

  function drawResult(): void {
    const v = snap.view;
    if (v.phase === 'STARTING') {
      result.hidden = false;
      result.className = 'gomoku-result oc-result starting';
      result.replaceChildren(
        h('p', { class: 'result-title' }, '곧 시작합니다'),
        h('p', { class: 'hint' }, '7장씩 나눠 줘요'),
      );
      return;
    }
    if (v.phase !== 'GAME_OVER') {
      result.hidden = true;
      return;
    }
    const rows = [...seated()].sort((a, b) => (a.rank || 99) - (b.rank || 99));
    const mine = me();
    const title = !mine || mine.seat < 0 ? '게임 끝' : mine.rank === 1 ? '1위! 다 냈어요' : `${mine.rank}위`;
    const again = h('button', { class: 'btn btn-primary', type: 'button' }, '다시 하기');
    again.addEventListener('click', () => session.send('rematch', {}));
    const leave = h('button', { class: 'btn', type: 'button' }, '나가기');
    leave.addEventListener('click', onExit);
    result.hidden = false;
    result.className = `gomoku-result oc-result ${mine?.rank === 1 ? 'win' : ''}`;
    result.replaceChildren(
      h('p', { class: 'result-title' }, title),
      h(
        'ol',
        { class: 'oc-ranking' },
        ...rows.map((p) =>
          h(
            'li',
            { class: p.id === snap.me ? 'me' : '' },
            h('b', {}, `${p.rank}위`),
            h('span', {}, p.nickname),
            h(
              'span',
              { class: 'hint' },
              p.status === 'bankrupt' ? '파산' : p.handCount === 0 ? '다 냄' : `${p.handCount}장 남음`,
            ),
          ),
        ),
      ),
      h('div', { class: 'result-actions' }, leave, again),
    );
  }

  function paint(): void {
    drawOpponents();
    drawCenter();
    drawHand();
    drawCall();
    drawNotice();
    drawResult();
    conn.replaceChildren(snap.connection === 'online' ? '' : svg(icons.offline));
    tick();
  }

  function tick(): void {
    cancelAnimationFrame(raf);
    const v = snap.view;
    const bar = timer.querySelector<HTMLElement>('i');
    if (bar) {
      if (v.phase === 'PLAYING' && v.windowId && v.windowClosesAt > 0) {
        const left = Math.max(0, v.windowClosesAt - session.serverNow());
        bar.style.transform = `scaleX(${Math.min(1, left / oneCard.ONE_CARD_WINDOW_MS)})`;
        timer.classList.add('urgent');
      } else if (v.phase === 'PLAYING' && v.deadline > 0) {
        const left = Math.max(0, v.deadline - session.serverNow());
        bar.style.transform = `scaleX(${Math.min(1, left / (v.options.turnSeconds * 1000))})`;
        timer.classList.toggle('urgent', left <= URGENT_MS || v.attack > 0);
      } else {
        bar.style.transform = 'scaleX(0)';
      }
    }
    raf = requestAnimationFrame(tick);
  }

  const off = session.subscribe((s) => {
    const turnChanged = s.view.turnId !== snap.view.turnId;
    snap = s;
    if (turnChanged) sheetSlot.replaceChildren();
    paint();
  });
  const onResize = () => drawHand();
  window.addEventListener('resize', onResize);
  const noticeTimer = window.setInterval(drawNotice, 500);

  return () => {
    off();
    cancelAnimationFrame(raf);
    window.clearInterval(noticeTimer);
    window.removeEventListener('resize', onResize);
  };
}
