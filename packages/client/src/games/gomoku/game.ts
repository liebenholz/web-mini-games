import { gomoku } from '@wmg/rules';
import { h, svg } from '../../dom.js';
import { icons } from '../../icons.js';
import type { GomokuPlayerView, GomokuSession } from './session.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const N = gomoku.GOMOKU_SIZE;
/** viewBox 단위: 가장자리 10, 칸 10 → 교차점 10~150 */
const PAD = 10;
const CELL = 10;
const VIEW = PAD * 2 + CELL * (N - 1);
const STAR_POINTS = [
  [3, 3],
  [3, 11],
  [7, 7],
  [11, 3],
  [11, 11],
] as const;
const URGENT_MS = 5000;

type Point = gomoku.Point;

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** 판 좌표 → viewBox 좌표. y=0(1행)이 아래 */
const sx = (x: number) => PAD + x * CELL;
const sy = (y: number) => PAD + (N - 1 - y) * CELL;

const samePoint = (a: Point | null, b: Point | null) => Boolean(a && b && a.x === b.x && a.y === b.y);

/**
 * 오목 대국 화면 (gomoku.md 8장, G-30~G-37).
 * 입력은 기기가 아니라 포인터 종류로 나눈다: 마우스는 호버 미리보기 + 클릭 착수,
 * 터치는 첫 터치 미리보기 + 같은 자리 다시 터치(또는 "여기에 두기")로 착수, 키보드는 방향키 + Enter.
 */
export function mountGomokuGame(root: HTMLElement, session: GomokuSession, onExit: () => void): () => void {
  let snap = session.snapshot;
  /** 마우스 호버 또는 키보드 커서 */
  let hover: Point | null = null;
  /** 터치 첫 탭으로 고른 자리 (G-31) */
  let pending: Point | null = null;
  let lastTurnId = '';
  let sawHover = false;
  let raf = 0;

  const exit = h('button', { class: 'btn btn-ghost back-link', type: 'button' }, svg(icons.back), '나가기');
  exit.addEventListener('click', () => {
    const playing = snap.view.phase === 'PLAYING' && Boolean(me()?.color);
    if (!playing || confirm('대국에서 나갈까요? 봇이 이어서 둡니다.')) onExit();
  });
  const conn = h('span', { class: 'hint' });
  const moves = h('span', { class: 'gomoku-moves' });
  const statusbar = h('header', { class: 'statusbar gomoku-bar' }, exit, conn, moves);

  const players = h('div', { class: 'gomoku-players' });
  const notice = h('div', { class: 'gomoku-notice', role: 'status', 'aria-live': 'polite' });

  const board = el('svg', {
    viewBox: `0 0 ${VIEW} ${VIEW}`,
    class: 'gomoku-board',
    role: 'grid',
    tabindex: 0,
    'aria-label': '오목판 15×15. 방향키로 옮기고 Enter로 둡니다',
    'data-testid': 'gomoku-board',
  });
  const help = h(
    'div',
    { class: 'gomoku-help' },
    h('p', {}, '마우스를 올리면 반투명 돌, ', h('b', {}, '클릭하면 둡니다.')),
    h('p', {}, h('span', { class: 'x-mark', 'aria-hidden': 'true' }, '✕'), ' 흑이 둘 수 없는 자리 (금수)'),
    h('p', {}, '방향키 + Enter로도 둘 수 있어요'),
  );

  const confirmLabel = h('strong', {});
  const confirmCancel = h('button', { class: 'btn', type: 'button' }, '취소');
  const confirmPlace = h(
    'button',
    { class: 'btn btn-primary', type: 'button', 'data-testid': 'place-confirm' },
    '여기에 두기',
  );
  const confirmBar = h(
    'div',
    { class: 'gomoku-confirm', hidden: true, 'data-testid': 'touch-confirm' },
    h('div', {}, confirmLabel, h('span', { class: 'hint' }, '같은 자리를 한 번 더 누르면 둡니다')),
    h('div', { class: 'gomoku-confirm-actions' }, confirmCancel, confirmPlace),
  );
  confirmCancel.addEventListener('click', () => {
    pending = null;
    paint();
  });
  confirmPlace.addEventListener('click', () => {
    if (pending) place(pending);
  });

  const result = h('div', { class: 'gomoku-result', hidden: true, 'data-testid': 'result' });
  const side = h('aside', { class: 'gomoku-side' }, players, help);
  const main = h('div', { class: 'gomoku-main' }, h('div', { class: 'board-wrap' }, board), side);
  const shell = h('div', { class: 'gomoku' }, statusbar, notice, main, confirmBar, result);
  root.replaceChildren(shell);

  function me(): GomokuPlayerView | undefined {
    return snap.view.players.find((p) => p.id === snap.me);
  }

  function myTurn(): boolean {
    const m = me();
    return (
      snap.view.phase === 'PLAYING' && Boolean(m?.color) && snap.view.currentTurn === snap.me && !m?.spectator
    );
  }

  function rules(): gomoku.GomokuRuleOptions {
    return snap.view.options;
  }

  /** 내 차례이고 둘 수 있는 빈칸인가 (G-34) */
  function canPlace(p: Point): boolean {
    const m = me();
    if (!myTurn() || !m?.color) return false;
    return gomoku.checkPlace(snap.view.board, p, m.color, rules()).ok;
  }

  function place(p: Point): void {
    if (!canPlace(p)) return;
    session.send('place', { x: p.x, y: p.y, turnId: snap.view.turnId });
    pending = null;
    hover = null;
    paint();
  }

  function pointFromEvent(e: PointerEvent): Point | null {
    const rect = board.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * VIEW;
    const vy = ((e.clientY - rect.top) / rect.height) * VIEW;
    const x = Math.round((vx - PAD) / CELL);
    const y = N - 1 - Math.round((vy - PAD) / CELL);
    if (!gomoku.inBounds(x, y)) return null;
    // 교차점에서 너무 먼 곳(칸 가운데 근처)은 무시하지 않는다: 가장 가까운 교차점을 쓴다
    return { x, y };
  }

  // G-30: 마우스(와 호버가 되는 펜)는 올리면 미리보기
  board.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    if (e.pointerType === 'pen') sawHover = true;
    const p = pointFromEvent(e);
    if (!samePoint(p, hover)) {
      hover = p;
      paint();
    }
  });
  board.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'touch') return;
    hover = null;
    paint();
  });
  board.addEventListener('pointerup', (e) => {
    const p = pointFromEvent(e);
    if (!p) return;
    const twoStep = e.pointerType === 'touch' || (e.pointerType === 'pen' && !sawHover);
    if (!twoStep) {
      place(p);
      return;
    }
    // G-31: 첫 터치는 미리보기, 같은 자리를 다시 누르면 착수
    if (samePoint(p, pending)) place(p);
    else if (canPlace(p)) {
      pending = p;
      paint();
    } else if (myTurn()) {
      pending = null;
      paint();
    }
  });
  // G-33: 키보드
  board.addEventListener('keydown', (e) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
    };
    const d = moves[e.key];
    if (d) {
      e.preventDefault();
      const start = hover ?? (snap.view.lastMove >= 0 ? gomoku.pointOf(snap.view.lastMove) : { x: 7, y: 7 });
      hover = {
        x: Math.min(N - 1, Math.max(0, start.x + d[0])),
        y: Math.min(N - 1, Math.max(0, start.y + d[1])),
      };
      paint();
    } else if ((e.key === 'Enter' || e.key === ' ') && hover) {
      e.preventDefault();
      place(hover);
    } else if (e.key === 'Escape') {
      hover = null;
      pending = null;
      paint();
    }
  });

  function drawBoard(): void {
    const v = snap.view;
    const parts: SVGElement[] = [el('rect', { x: 0, y: 0, width: VIEW, height: VIEW, rx: 4, class: 'wood' })];
    const lines = el('g', { class: 'grid-lines' });
    for (let i = 0; i < N; i += 1) {
      lines.append(el('line', { x1: sx(0), y1: sy(i), x2: sx(N - 1), y2: sy(i) }));
      lines.append(el('line', { x1: sx(i), y1: sy(0), x2: sx(i), y2: sy(N - 1) }));
    }
    parts.push(lines);
    for (const [x, y] of STAR_POINTS)
      parts.push(el('circle', { cx: sx(x), cy: sy(y), r: 1.1, class: 'star' }));

    // 터치 미리보기: 그 줄과 칸을 옅게 강조 (G-31)
    if (pending) {
      parts.push(
        el('rect', {
          x: PAD - CELL / 2,
          y: sy(pending.y) - CELL / 2,
          width: VIEW - 2 * PAD + CELL,
          height: CELL,
          class: 'lane',
        }),
      );
      parts.push(
        el('rect', {
          x: sx(pending.x) - CELL / 2,
          y: PAD - CELL / 2,
          width: CELL,
          height: VIEW - 2 * PAD + CELL,
          class: 'lane',
        }),
      );
    }

    const winSet = new Set(v.winLine);
    v.board.forEach((c, i) => {
      if (c === gomoku.EMPTY) return;
      const p = gomoku.pointOf(i);
      const stone = el('circle', {
        cx: sx(p.x),
        cy: sy(p.y),
        r: 4.4,
        class: `stone ${c === gomoku.BLACK ? 'black' : 'white'}${winSet.has(i) ? ' win' : ''}`,
      });
      parts.push(stone);
    });
    if (v.lastMove >= 0) {
      const p = gomoku.pointOf(v.lastMove);
      parts.push(el('circle', { cx: sx(p.x), cy: sy(p.y), r: 1.3, class: 'last-move' }));
    }

    // 금수 표시: 내가 흑이고 내 차례일 때 (G-34)
    const m = me();
    if (myTurn() && m?.color === 'black') {
      for (const f of gomoku.forbiddenPoints(v.board, rules())) {
        const g = el('g', { class: 'forbidden', 'data-reason': f.reason });
        const x = sx(f.point.x);
        const y = sy(f.point.y);
        g.append(el('line', { x1: x - 2.4, y1: y - 2.4, x2: x + 2.4, y2: y + 2.4 }));
        g.append(el('line', { x1: x + 2.4, y1: y - 2.4, x2: x - 2.4, y2: y + 2.4 }));
        parts.push(g);
      }
    }

    // 반투명 돌: 내 차례이고 둘 수 있는 빈칸에만 (G-34)
    const ghostAt = pending ?? hover;
    if (ghostAt && m?.color && canPlace(ghostAt)) {
      parts.push(
        el('circle', {
          cx: sx(ghostAt.x),
          cy: sy(ghostAt.y),
          r: 4.4,
          class: `ghost ${m.color}`,
          'data-testid': 'ghost',
        }),
      );
      if (pending)
        parts.push(el('circle', { cx: sx(ghostAt.x), cy: sy(ghostAt.y), r: 6, class: 'ghost-ring' }));
    }
    board.replaceChildren(...parts);
    board.setAttribute(
      'aria-label',
      `오목판 15×15, ${v.moveCount}수. ${turnText()}. 방향키로 옮기고 Enter로 둡니다`,
    );
  }

  function turnText(): string {
    const v = snap.view;
    if (v.phase === 'STARTING') return '곧 시작합니다';
    if (v.phase !== 'PLAYING') return '대국이 끝났습니다';
    if (myTurn()) return '내 차례';
    const p = v.players.find((x) => x.id === v.currentTurn);
    return `${p?.nickname ?? ''} 님 차례`;
  }

  function playerCard(color: gomoku.GomokuColor): HTMLElement {
    const v = snap.view;
    const p = v.players.find((x) => x.color === color);
    const active = v.phase === 'PLAYING' && p && v.currentTurn === p.id;
    const tags = [
      p?.id === snap.me
        ? h('span', { class: 'tag mine' }, active ? '내 차례' : '나')
        : active
          ? h('span', { class: 'tag' }, '차례')
          : null,
      p?.replaced ? h('span', { class: 'tag bot' }, '봇이 대신') : null,
      p && !p.connected ? h('span', { class: 'tag off' }, '연결 끊김') : null,
    ];
    const timer = active ? h('div', { class: 'gomoku-timer', 'data-timer': '' }, h('i')) : null;
    const left = active ? h('span', { class: 'hint', 'data-seconds': '' }) : null;
    return h(
      'div',
      { class: `player-card${active ? ' active' : ''}`, 'data-color': color },
      h(
        'div',
        { class: 'player-line' },
        h('span', { class: `stone-dot ${color}`, 'aria-label': color === 'black' ? '흑' : '백' }),
        h('span', { class: 'name' }, p?.nickname ?? '—'),
        ...tags,
      ),
      timer,
      left,
    );
  }

  function drawPlayers(): void {
    players.replaceChildren(playerCard('black'), playerCard('white'));
  }

  function drawNotice(): void {
    const n = snap.notice;
    const v = snap.view;
    let text = '';
    let kind = '';
    if (n && v.phase === 'PLAYING' && n.playerId !== snap.me) {
      const p = v.players.find((x) => x.id === n.playerId);
      const age = Date.now() - n.at;
      if (n.reason === 'left' && age < 8000) {
        text = `${n.nickname} 님이 나가서 봇이 이어서 둡니다.`;
        kind = 'bot';
      } else if (n.reason === 'disconnected' && p && !p.connected) {
        text = `${n.nickname} 님 연결 끊김 · 시간 안에 돌아오지 않으면 시간패`;
        kind = 'off';
      } else if (n.reason === 'returned' && age < 4000) {
        text = `${n.nickname} 님이 다시 연결됐어요.`;
        kind = 'ok';
      }
    }
    notice.className = `gomoku-notice ${kind}`;
    notice.hidden = !text;
    notice.replaceChildren(
      text ? svg(kind === 'bot' ? icons.robot : kind === 'off' ? icons.wifiOff : icons.link) : '',
      text,
    );
  }

  function drawConfirm(): void {
    confirmBar.hidden = !pending;
    if (pending) confirmLabel.textContent = `${gomoku.coordLabel(pending)}에 둘까요?`;
  }

  function drawResult(): void {
    const v = snap.view;
    if (v.phase === 'STARTING') {
      result.hidden = false;
      result.className = 'gomoku-result starting';
      const m = me();
      result.replaceChildren(
        h('p', { class: 'result-title' }, '곧 시작합니다'),
        h(
          'p',
          { class: 'hint' },
          m?.color ? `나는 ${m.color === 'black' ? '흑 (먼저 둬요)' : '백'}` : '관전 중',
        ),
      );
      return;
    }
    if (v.phase !== 'GAME_OVER') {
      result.hidden = true;
      return;
    }
    const winner = v.players.find((p) => p.id === v.winnerId);
    const mine = me();
    const title =
      v.result === 'draw'
        ? '무승부'
        : !mine?.color
          ? `${winner?.color === 'black' ? '흑' : '백'} 승리`
          : v.winnerId === snap.me
            ? '이겼어요!'
            : '졌어요';
    const reason =
      v.result === 'five'
        ? `${winner?.nickname ?? ''} 님이 다섯을 이었어요`
        : v.result === 'timeout'
          ? '시간패로 끝났어요'
          : '판이 다 찼어요';
    const again = h('button', { class: 'btn btn-primary', type: 'button' }, '다시 하기');
    again.addEventListener('click', () => session.send('rematch', {}));
    const leave = h('button', { class: 'btn', type: 'button' }, '나가기');
    leave.addEventListener('click', onExit);
    result.hidden = false;
    result.className = `gomoku-result ${v.winnerId === snap.me ? 'win' : ''}`;
    result.replaceChildren(
      h('p', { class: 'result-title' }, title),
      h('p', { class: 'hint' }, reason),
      h('div', { class: 'result-actions' }, leave, again),
    );
  }

  function paint(): void {
    drawBoard();
    drawPlayers();
    drawNotice();
    drawConfirm();
    drawResult();
    conn.replaceChildren(snap.connection === 'online' ? '' : svg(icons.offline));
    moves.textContent = `${snap.view.moveCount}수`;
    tick();
  }

  function tick(): void {
    cancelAnimationFrame(raf);
    const v = snap.view;
    const bar = players.querySelector<HTMLElement>('[data-timer] i');
    const secs = players.querySelector<HTMLElement>('[data-seconds]');
    if (bar && v.phase === 'PLAYING' && v.deadline > 0) {
      const left = Math.max(0, v.deadline - session.serverNow());
      const ratio = Math.min(1, left / (v.options.turnSeconds * 1000));
      bar.style.transform = `scaleX(${ratio})`;
      bar.parentElement?.classList.toggle('urgent', left <= URGENT_MS);
      if (secs) secs.textContent = `${Math.ceil(left / 1000)}초 남음`;
    }
    raf = requestAnimationFrame(tick);
  }

  const off = session.subscribe((s) => {
    snap = s;
    // G-35: 차례가 바뀌거나 그 자리가 찼으면 선택을 지운다
    if (s.view.turnId !== lastTurnId) {
      lastTurnId = s.view.turnId;
      pending = null;
    }
    if (pending && s.view.board[gomoku.indexOf(pending.x, pending.y)] !== gomoku.EMPTY) pending = null;
    paint();
  });
  const noticeTimer = window.setInterval(drawNotice, 1000);

  return () => {
    off();
    cancelAnimationFrame(raf);
    window.clearInterval(noticeTimer);
  };
}
