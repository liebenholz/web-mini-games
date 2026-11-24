import { BID_FACES, type Bid, type BidFace } from '@wmg/rules';
import { panelState, type PanelSelection } from '../bidPanel.js';
import { h, svg, toast } from '../dom.js';
import { dieSvg, icons } from '../icons.js';
import { describeError, type Session, type SessionSnapshot } from '../net.js';
import type { TableModel, TableScene } from '../game/TableScene.js';
import { describeReveal, summarizeReveal, type RevealSummary } from '../revealSummary.js';

const URGENT_MS = 5000;

/** 판정 요약 (B안). live면 남은 시간을 붙인다. headline이면 "누구의 선언 · 누가 라이어"를 맨 위에 둔다 */
function summaryView(
  summary: RevealSummary,
  s: SessionSnapshot,
  opts: { live: boolean; headline: boolean },
): { root: HTMLElement; countdown: HTMLElement | null } {
  const t = describeReveal(summary, s.view.players, s.me);
  const countdown = opts.live ? h('span', { class: 'hint' }) : null;
  const chipDie = (face: number) =>
    h('span', { class: 'chip-die', 'aria-hidden': 'true' }, svg(dieSvg(face, `${face}`)));
  const root = h(
    'div',
    { class: 'summary', role: 'status', 'data-testid': 'reveal-summary' },
    h(
      'div',
      { class: 'summary-top' },
      h('span', { class: `pill ${summary.succeeded ? 'pill-ok' : 'pill-bad'}` }, t.verdict),
      countdown,
    ),
    opts.headline
      ? h(
          'p',
          { class: 'summary-headline' },
          h('span', {}, t.bidderPart),
          h('span', { class: 'sep', 'aria-hidden': 'true' }, ' · '),
          h('span', { class: 'liar' }, t.callerPart),
          h('span', { class: 'hint' }, ` (${t.bidPart})`),
        )
      : null,
    h(
      'div',
      {
        class: 'calc',
        'aria-label': `${summary.face} ${summary.faceCount}개, 와일드 1 ${summary.wildCount}개, 합계 ${summary.actual}개`,
      },
      h('span', { class: 'chip' }, chipDie(summary.face), `${summary.faceCount}개`),
      h('span', { class: 'op', 'aria-hidden': 'true' }, '+'),
      h(
        'span',
        { class: 'chip' },
        chipDie(1),
        `${summary.wildCount}개`,
        h('span', { class: 'hint' }, '와일드'),
      ),
      h('span', { class: 'op', 'aria-hidden': 'true' }, '='),
      h('span', { class: 'chip chip-total' }, `${summary.actual}개`),
    ),
    h('p', { class: 'reason' }, t.reason),
    h(
      'div',
      { class: 'loss' },
      h('span', { class: 'minus' }, summary.loserEliminated ? '탈락' : '-1'),
      h('span', {}, `${t.loss} · ${t.next}`),
    ),
  );
  return { root, countdown };
}

/** 게임 화면: 상태 줄 + Phaser 테이블 + 선언 패널 (명세 8장). 반환값은 정리 함수 */
export function mountGame(root: HTMLElement, session: Session, onExit: () => void): () => void {
  const total = h('span', { class: 'total', 'aria-live': 'polite' });
  const conn = h('span', { class: 'hint' });
  const tableHost = h('div', { class: 'table', 'aria-label': '게임 테이블', role: 'img' });
  const panel = h('section', { class: 'panel', 'aria-label': '선언' });
  const statusbar = h('header', { class: 'statusbar' }, conn, total);
  const shell = h('div', { class: 'game' }, statusbar, tableHost, panel);
  root.replaceChildren(shell);

  let scene: TableScene | null = null;
  let destroyTable: (() => void) | null = null;
  let selection: PanelSelection | null = null;
  let selectionTurn = '';
  let sentTurn = '';
  let vibratedTurn = '';
  let overlay: HTMLElement | null = null;
  let raf = 0;
  let disposed = false;
  // 라운드별 판정 요약. 공개 시점(패배 반영 전) 상태로 한 번만 계산해 둔다
  const summaries = new Map<number, RevealSummary>();
  let liveCountdown: HTMLElement | null = null;
  let recall: {
    backdrop: HTMLElement;
    trigger: HTMLElement | null;
    turnId: string;
    onKey: (e: KeyboardEvent) => void;
  } | null = null;

  function summaryFor(s: SessionSnapshot): RevealSummary | null {
    if (!s.reveal) return null;
    let summary = summaries.get(s.reveal.roundNo);
    if (!summary) {
      summary = summarizeReveal(s.reveal, s.view.players, s.view.bids);
      summaries.set(s.reveal.roundNo, summary);
      for (const round of summaries.keys()) if (round < s.reveal.roundNo - 1) summaries.delete(round);
    }
    return summary;
  }

  function closeRecall(): void {
    if (!recall) return;
    document.removeEventListener('keydown', recall.onKey);
    recall.backdrop.remove();
    if (recall.trigger?.isConnected) recall.trigger.focus();
    recall = null;
  }

  /** 3번 안: 지나간 판정을 아래에서 올라오는 시트로 다시 보여 준다 */
  function openRecall(summary: RevealSummary, trigger: HTMLElement): void {
    closeRecall();
    const s = session.snapshot;
    const close = h(
      'button',
      { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': '닫기' },
      svg(icons.close),
    );
    const sheet = h(
      'div',
      { class: 'recall-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'recall-title' },
      h('div', { class: 'recall-head' }, h('h2', { id: 'recall-title' }, '직전 판정'), close),
      summaryView(summary, s, { live: false, headline: true }).root,
    );
    const backdrop = h('div', { class: 'recall-backdrop', 'data-testid': 'recall' }, sheet);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeRecall();
    });
    close.addEventListener('click', closeRecall);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRecall();
    };
    document.addEventListener('keydown', onKey);
    document.body.append(backdrop);
    recall = { backdrop, trigger, turnId: s.view.turnId, onKey };
    close.focus();
  }

  const timerBar = h('i');
  const timer = h('div', { class: 'timer', 'aria-hidden': 'true' }, timerBar);

  void import('../game/TableScene.js').then(async ({ mountTable }) => {
    const mounted = await mountTable(tableHost);
    if (disposed) {
      mounted.destroy();
      return;
    }
    scene = mounted.scene;
    destroyTable = mounted.destroy;
    render(session.snapshot);
  });

  const offError = session.onEvent((type, payload) => {
    if (type !== 'error') return;
    const p = payload as { code: string; message: string };
    // 이중 클릭(STALE_TURN)은 조용히 무시한다 (TC-12)
    if (p.code !== 'STALE_TURN') toast(p.message || describeError(p.code));
  });

  function currentBid(s: SessionSnapshot): Bid | null {
    const last = s.view.bids.at(-1);
    return last ? { quantity: last.quantity, face: last.face as BidFace } : null;
  }

  function tableModel(s: SessionSnapshot): TableModel {
    const summary = summaryFor(s);
    return {
      revealText: summary ? { bidPart: describeReveal(summary, s.view.players, s.me).bidPart } : null,
      phase: s.view.phase,
      me: s.me,
      players: s.view.players,
      myDice: s.myDice,
      currentTurn: s.view.currentTurn,
      deadline: s.view.deadline,
      turnMs: s.view.options.turnSeconds * 1000,
      bids: s.view.bids,
      reveal: s.reveal,
      roundNo: s.view.roundNo,
      serverNow: () => session.serverNow(),
    };
  }

  function tick(): void {
    const s = session.snapshot;
    if (s.view.phase === 'BIDDING' && s.view.deadline > 0) {
      const left = Math.max(0, s.view.deadline - session.serverNow());
      const ratio = Math.min(1, left / (s.view.options.turnSeconds * 1000));
      timerBar.style.transform = `scaleX(${ratio})`;
      const urgent = left <= URGENT_MS;
      timer.classList.toggle('urgent', urgent);
      // 명세 8장: 5초 남으면 색상과 진동 (내 차례일 때 한 번)
      if (urgent && s.view.currentTurn === s.me && vibratedTurn !== s.view.turnId) {
        vibratedTurn = s.view.turnId;
        navigator.vibrate?.(180);
      }
    } else {
      timerBar.style.transform = 'scaleX(0)';
    }
    // 공개 중: "N초 뒤 다음 라운드" (서버 마감 시각 기준, S-05)
    if (liveCountdown && (s.view.phase === 'REVEAL' || s.view.phase === 'RESOLVE')) {
      const left = Math.max(0, s.view.phaseEndsAt - session.serverNow());
      const summary = s.reveal ? summaries.get(s.reveal.roundNo) : undefined;
      const what = summary && summary.nextStarterId === null ? '결과' : '다음 라운드';
      liveCountdown.textContent = `${Math.max(1, Math.ceil(left / 1000))}초 뒤 ${what}`;
    }
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  function renderPanel(s: SessionSnapshot): void {
    // 공개 중에는 선언 패널 자리에 판정 요약을 보여 준다 (B안). 높이를 유지해 테이블이 흔들리지 않게 한다
    const live = s.view.phase === 'REVEAL' || s.view.phase === 'RESOLVE' ? summaryFor(s) : null;
    if (live) {
      const before = panel.offsetHeight;
      const view = summaryView(live, s, { live: true, headline: true });
      liveCountdown = view.countdown;
      panel.replaceChildren(view.root);
      if (before > 0) panel.style.minHeight = `${before}px`;
      return;
    }
    liveCountdown = null;
    panel.style.minHeight = '';

    // 3번 안: 다음 라운드 동안 직전 판정을 다시 볼 수 있다
    const previous = s.view.phase === 'BIDDING' ? summaries.get(s.view.roundNo - 1) : undefined;
    let recallBtn: HTMLElement | null = null;
    if (previous) {
      const btn = h(
        'button',
        { class: 'btn btn-ghost recall-btn', type: 'button', 'data-testid': 'recall-open' },
        svg(icons.history),
        '직전 판정',
      );
      btn.addEventListener('click', () => openRecall(previous, btn));
      recallBtn = btn;
    }

    const me = s.view.players.find((p) => p.id === s.me);
    const turnPlayer = s.view.players.find((p) => p.id === s.view.currentTurn);
    const myTurn = s.view.phase === 'BIDDING' && s.view.currentTurn === s.me && sentTurn !== s.view.turnId;
    if (selectionTurn !== s.view.turnId) {
      selectionTurn = s.view.turnId;
      selection = null; // 새 턴: 가장 낮은 합법 선언으로 다시 제안
    }
    const input = { currentBid: currentBid(s), totalDice: s.view.totalDice, myTurn };
    const state = panelState(input, selection);
    selection = state.selection;

    let status: string;
    if (s.view.phase === 'BIDDING')
      status = s.view.currentTurn === s.me ? '내 차례' : `${turnPlayer?.nickname ?? ''} 님 차례`;
    else if (s.view.phase === 'REVEAL' || s.view.phase === 'RESOLVE') status = '공개!';
    else if (s.view.phase === 'STARTING') status = '곧 시작';
    else if (s.view.phase === 'ROLLING') status = '주사위를 굴립니다';
    else status = '';
    const statusEl = h(
      'span',
      { class: `who ${s.view.currentTurn === s.me && s.view.phase === 'BIDDING' ? 'mine' : ''}` },
      status,
    );
    const extra = me?.autopilot
      ? h('span', { class: 'hint' }, '자동 진행 중 · 직접 선언하면 돌아옵니다')
      : null;

    if (s.role === 'spectator' || !me || me.spectator || me.eliminated) {
      panel.replaceChildren(
        h(
          'div',
          { class: 'turn-line' },
          statusEl,
          h(
            'span',
            { class: 'turn-extra' },
            h('span', { class: 'hint' }, me?.eliminated ? '탈락 · 관전 중' : '관전 중'),
            recallBtn,
          ),
        ),
        timer,
      );
      return;
    }

    const minus = h(
      'button',
      { class: 'btn', type: 'button', 'aria-label': '개수 줄이기', disabled: !state.canDecrease },
      svg(icons.minus),
    );
    const plus = h(
      'button',
      { class: 'btn', type: 'button', 'aria-label': '개수 늘리기', disabled: !state.canIncrease },
      svg(icons.plus),
    );
    const qty = h(
      'output',
      { 'aria-live': 'polite', 'aria-label': '개수' },
      state.selection ? String(state.selection.quantity) : '–',
    );
    minus.addEventListener('click', () => {
      if (selection) selection = { ...selection, quantity: selection.quantity - 1 };
      renderPanel(session.snapshot);
    });
    plus.addEventListener('click', () => {
      if (selection) selection = { ...selection, quantity: selection.quantity + 1 };
      renderPanel(session.snapshot);
    });

    const faces = h('div', { class: 'faces', role: 'group', 'aria-label': '눈 선택' });
    for (const f of BID_FACES) {
      const b = h(
        'button',
        {
          class: 'face',
          type: 'button',
          'aria-pressed': String(state.selection?.face === f),
          disabled: !myTurn || !state.faceEnabled[f],
        },
        svg(dieSvg(f, `${f}`)),
      );
      b.addEventListener('click', () => {
        selection = { quantity: selection?.quantity ?? 1, face: f };
        renderPanel(session.snapshot);
      });
      faces.append(b);
    }

    const bidLabel = state.selection ? `${state.selection.quantity} × ${state.selection.face}` : '';
    const bidBtn = h(
      'button',
      { class: 'btn btn-primary', type: 'button', disabled: !state.canBid, 'data-testid': 'bid' },
      h('span', {}, '선언'),
      h('span', { class: 'bid-label' }, bidLabel),
    );
    bidBtn.addEventListener('click', () => {
      const snap = session.snapshot;
      if (!selection || sentTurn === snap.view.turnId) return;
      sentTurn = snap.view.turnId; // TC-12: 같은 턴에 한 번만 보낸다
      session.send('bid', { quantity: selection.quantity, face: selection.face, turnId: snap.view.turnId });
      renderPanel(snap);
    });
    const liarBtn = h(
      'button',
      { class: 'btn btn-danger', type: 'button', disabled: !state.canLiar, 'data-testid': 'liar' },
      '라이어!',
    );
    liarBtn.addEventListener('click', () => {
      const snap = session.snapshot;
      if (sentTurn === snap.view.turnId) return;
      sentTurn = snap.view.turnId;
      session.send('call_liar', { turnId: snap.view.turnId });
      renderPanel(snap);
    });

    panel.replaceChildren(
      h(
        'div',
        { class: 'turn-line' },
        statusEl,
        h(
          'span',
          { class: 'turn-extra' },
          extra ?? (state.liarOnly && myTurn ? h('span', { class: 'hint' }, '더 올릴 수 없습니다') : null),
          recallBtn,
        ),
      ),
      timer,
      h('div', { class: 'bid-row' }, h('div', { class: 'stepper' }, minus, qty, plus), faces),
      h('div', { class: 'actions' }, bidBtn, liarBtn),
    );
  }

  function renderOverlay(s: SessionSnapshot): void {
    const wantResult = s.view.phase === 'GAME_OVER' && s.ranking;
    const wantReconnect = s.connection === 'reconnecting';
    overlay?.remove();
    overlay = null;
    if (wantReconnect) {
      overlay = h(
        'div',
        { class: 'overlay', role: 'alertdialog', 'aria-label': '재접속 중' },
        h(
          'div',
          { class: 'sheet centered' },
          h('div', { class: 'spinner' }),
          h('h2', {}, '재접속 중'),
          h('p', { class: 'muted' }, '자리는 60초 동안 유지됩니다.'),
        ),
      );
    } else if (wantResult && s.ranking) {
      const list = h('ol', { class: 'ranking' });
      for (const r of [...s.ranking].sort((a, b) => a.rank - b.rank)) {
        list.append(
          h(
            'li',
            {},
            h('span', { class: 'rank' }, String(r.rank)),
            h('span', { class: 'name' }, r.nickname + (r.playerId === s.me ? ' (나)' : '')),
            h('span', { class: 'hint' }, r.isBot ? '봇' : ''),
          ),
        );
      }
      const again = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, '다시 하기');
      again.addEventListener('click', () => session.send('rematch', {}));
      const lobby = h('button', { class: 'btn btn-block', type: 'button' }, '로비로');
      lobby.addEventListener('click', onExit);
      const winner = s.ranking.find((r) => r.rank === 1);
      overlay = h(
        'div',
        { class: 'overlay', role: 'dialog', 'aria-label': '결과', 'data-testid': 'result' },
        h(
          'div',
          { class: 'sheet' },
          h('h2', {}, winner?.playerId === s.me ? '승리!' : `${winner?.nickname ?? ''} 님 승리`),
          list,
          again,
          lobby,
        ),
      );
    }
    if (overlay) document.body.append(overlay);
  }

  function render(s: SessionSnapshot): void {
    total.replaceChildren('판 위 주사위 ', h('b', {}, String(s.view.totalDice || '–')), '개');
    conn.replaceChildren(s.connection === 'online' ? '' : svg(icons.offline));
    // 직전 판정 시트는 공개가 다시 시작되거나 새로 내 차례가 오면 닫는다 (선언 패널을 가리지 않게)
    if (
      recall &&
      (s.view.phase !== 'BIDDING' || (s.view.currentTurn === s.me && s.view.turnId !== recall.turnId))
    ) {
      closeRecall();
    }
    scene?.setModel(tableModel(s));
    tableHost.setAttribute('aria-label', describeTable(s));
    renderPanel(s);
    renderOverlay(s);
  }

  const off = session.subscribe(render);
  // 게임 중에는 방 코드를 보여 주지 않는다 (화면 공유·방송 때 노출 방지). 초대는 대기실에서 한다
  const back = h('button', { class: 'btn btn-ghost back-link', type: 'button' }, svg(icons.back), '나가기');
  back.addEventListener('click', () => {
    if (confirm('게임에서 나갈까요? 남은 주사위는 봇이 이어받습니다.')) onExit();
  });
  statusbar.prepend(back);

  return () => {
    disposed = true;
    off();
    offError();
    cancelAnimationFrame(raf);
    closeRecall();
    overlay?.remove();
    destroyTable?.();
  };
}

/** 스크린리더용 테이블 요약 (캔버스 대체 텍스트) */
function describeTable(s: SessionSnapshot): string {
  const last = s.view.bids.at(-1);
  const others = s.view.players
    .filter((p) => !p.spectator)
    .map((p) => `${p.nickname} ${p.eliminated ? '탈락' : `${p.diceCount}개`}`)
    .join(', ');
  const mine = s.myDice.length ? `내 주사위 ${s.myDice.join(', ')}.` : '';
  const bid = last ? `현재 선언 ${last.quantity}개의 ${last.face}.` : '';
  return `${others}. ${mine} ${bid}`;
}
