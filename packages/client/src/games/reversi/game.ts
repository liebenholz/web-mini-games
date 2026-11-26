import { reversi } from '@wmg/rules';
import { h, svg } from '../../dom.js';
import { icons } from '../../icons.js';
import type { ReversiPlayerView, ReversiSession, ReversiSnapshot } from './session.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const N = reversi.REVERSI_SIZE;
/** viewBox 단위: 가장자리 2, 칸 10 */
const PAD = 2;
const CELL = 10;
const VIEW = PAD * 2 + CELL * N;
const STONE_R = 4.1;
const URGENT_MS = 5000;
/** 뒤집힌 돌 고리를 보여 주는 시간 (시안 ①) */
const FLIP_MARK_MS = 1200;
/** 뒤집기 연출: 한 돌 250ms, 놓은 자리에서 한 칸 멀어질 때마다 40ms 늦게 */
const FLIP_MS = 250;
const FLIP_STAGGER_MS = 40;
/** 넘김·대신 두기 알림을 보여 주는 시간 */
const EVENT_MS = 4000;

type Point = reversi.Point;

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** 칸 가운데의 viewBox 좌표. y=0(1행)이 위 */
const cx = (x: number) => PAD + x * CELL + CELL / 2;

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 리버시 대국 화면 (reversi.md 6장, 시안 2026-11-27 확인).
 * 틀은 오목 화면과 같다 (상단 바, 흑·백 카드, 알림 줄, 결과 카드, PC 오른쪽 칸).
 * 입력: 둘 수 있는 칸을 누르면(클릭·터치 모두) 바로 둔다. 마우스는 올리면 뒤집힐 돌을 미리 보여 주고, 키보드는 방향키 + Enter.
 */
export function mountReversiGame(root: HTMLElement, session: ReversiSession, onExit: () => void): () => void {
  let snap: ReversiSnapshot = session.snapshot;
  /** 마우스 호버 또는 키보드 커서 */
  let hover: Point | null = null;
  /** 이 차례에 이미 보냈다 (같은 차례에 두 번 보내지 않는다) */
  let sentTurnId = '';
  let raf = 0;
  let flipTimer = 0;

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
    class: 'rv-board',
    role: 'grid',
    tabindex: 0,
    'aria-label': '리버시 판 8×8',
    'data-testid': 'reversi-board',
  });
  const help = h(
    'div',
    { class: 'gomoku-help' },
    h('p', {}, '둘 수 있는 자리에 ', h('b', {}, '점'), '이 보여요. 누르면 바로 둡니다.'),
    h('p', {}, '마우스를 올리면 뒤집힐 돌을 미리 보여 줘요.'),
    h('p', {}, '방향키 + Enter로도 둘 수 있어요'),
  );

  const result = h('div', { class: 'gomoku-result', hidden: true, 'data-testid': 'result' });
  // 결과 카드는 폰에서는 화면 아래에 떠 있고, PC에서는 오른쪽 칸에 들어가 판을 가리지 않는다
  const side = h('aside', { class: 'gomoku-side' }, players, help, result);
  const main = h('div', { class: 'gomoku-main rv-main' }, h('div', { class: 'board-wrap' }, board), side);
  const shell = h('div', { class: 'gomoku reversi' }, statusbar, notice, main);
  root.replaceChildren(shell);

  function me(): ReversiPlayerView | undefined {
    return snap.view.players.find((p) => p.id === snap.me);
  }

  function myColor(): reversi.ReversiColor | null {
    const m = me();
    return m && !m.spectator && m.color ? m.color : null;
  }

  function myTurn(): boolean {
    const v = snap.view;
    return (
      v.phase === 'PLAYING' && Boolean(myColor()) && v.currentTurn === snap.me && sentTurnId !== v.turnId
    );
  }

  /** RV-04: 내 차례에 둘 수 있는 자리 (뒤집힐 돌 포함) */
  function legal(): reversi.ReversiMove[] {
    const color = myColor();
    if (!color || !myTurn()) return [];
    return reversi.legalMoves(snap.view.board, color);
  }

  function legalAt(p: Point): reversi.ReversiMove | undefined {
    return legal().find((m) => m.x === p.x && m.y === p.y);
  }

  function place(p: Point): void {
    if (!legalAt(p)) return;
    const turnId = snap.view.turnId;
    sentTurnId = turnId;
    session.send('place', { x: p.x, y: p.y, turnId });
    // 서버가 거절하면 차례가 바뀌지 않는다. 잠시 뒤 다시 둘 수 있게 한다
    window.setTimeout(() => {
      if (sentTurnId === turnId && snap.view.turnId === turnId) {
        sentTurnId = '';
        paint();
      }
    }, 2000);
    hover = null;
    paint();
  }

  function pointFromEvent(e: PointerEvent): Point | null {
    const rect = board.getBoundingClientRect();
    const scale = rect.width / VIEW;
    const x = Math.floor((e.clientX - rect.left - PAD * scale) / (CELL * scale));
    const y = Math.floor((e.clientY - rect.top - PAD * scale) / (CELL * scale));
    return reversi.inBounds(x, y) ? { x, y } : null;
  }

  board.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const p = pointFromEvent(e);
    const next = p && legalAt(p) ? p : null;
    if (next?.x === hover?.x && next?.y === hover?.y) return;
    hover = next;
    drawBoard();
  });
  board.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'touch') return;
    hover = null;
    drawBoard();
  });
  // 6장: 클릭과 터치 모두 한 번에 둔다. 둘 수 없는 칸은 반응하지 않는다
  board.addEventListener('pointerup', (e) => {
    const p = pointFromEvent(e);
    if (p) place(p);
  });
  board.addEventListener('keydown', (e) => {
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = steps[e.key];
    if (d) {
      e.preventDefault();
      const start = hover ?? (snap.view.lastMove >= 0 ? reversi.pointOf(snap.view.lastMove) : { x: 3, y: 3 });
      hover = {
        x: Math.min(N - 1, Math.max(0, start.x + d[0])),
        y: Math.min(N - 1, Math.max(0, start.y + d[1])),
      };
      drawBoard();
    } else if ((e.key === 'Enter' || e.key === ' ') && hover) {
      e.preventDefault();
      place(hover);
    } else if (e.key === 'Escape') {
      hover = null;
      drawBoard();
    }
  });

  function drawBoard(): void {
    const v = snap.view;
    const parts: SVGElement[] = [
      el('rect', { x: 0, y: 0, width: VIEW, height: VIEW, rx: 2.5, class: 'felt' }),
    ];
    const grid = el('g', { class: 'grid' });
    for (let i = 0; i <= N; i += 1) {
      grid.append(el('line', { x1: PAD, y1: PAD + i * CELL, x2: PAD + N * CELL, y2: PAD + i * CELL }));
      grid.append(el('line', { x1: PAD + i * CELL, y1: PAD, x2: PAD + i * CELL, y2: PAD + N * CELL }));
    }
    parts.push(grid);
    for (const [x, y] of [
      [2, 2],
      [6, 2],
      [2, 6],
      [6, 6],
    ] as const)
      parts.push(el('circle', { cx: PAD + x * CELL, cy: PAD + y * CELL, r: 0.9, class: 'star' }));
    parts.push(el('rect', { x: PAD, y: PAD, width: N * CELL, height: N * CELL, class: 'edge' }));

    const moves = legal();
    const hovered = hover ? moves.find((m) => m.x === hover?.x && m.y === hover.y) : undefined;
    if (hover && v.phase === 'PLAYING')
      parts.push(
        el('rect', {
          x: PAD + hover.x * CELL,
          y: PAD + hover.y * CELL,
          width: CELL,
          height: CELL,
          class: 'cursor',
        }),
      );

    // 뒤집기 연출 (시안 ①): 다시 그려도 이어지게 경과 시간만큼 앞당겨 시작한다
    const flip = snap.flip;
    const flipAge = flip ? Date.now() - flip.at : Infinity;
    const flipping = new Map<number, number>();
    if (flip && flipAge < FLIP_MARK_MS) {
      const from = reversi.pointOf(flip.from);
      for (const i of flip.indices) {
        const p = reversi.pointOf(i);
        const dist = Math.max(Math.abs(p.x - from.x), Math.abs(p.y - from.y));
        flipping.set(i, dist * FLIP_STAGGER_MS - flipAge);
      }
    }
    const motion = !reducedMotion();
    v.board.forEach((c, i) => {
      if (c === reversi.EMPTY) return;
      const p = reversi.pointOf(i);
      const color = c === reversi.BLACK ? 'black' : 'white';
      const delay = flipping.get(i);
      const stone = el('circle', { cx: cx(p.x), cy: cx(p.y), r: STONE_R, class: `stone ${color}` });
      if (motion && delay !== undefined && delay + FLIP_MS > 0) {
        stone.classList.add(`flip-to-${color}`);
        stone.style.animationDelay = `${Math.round(delay)}ms`;
      }
      parts.push(stone);
    });
    for (const i of flipping.keys()) {
      const p = reversi.pointOf(i);
      parts.push(el('circle', { cx: cx(p.x), cy: cx(p.y), r: 4.8, class: 'flipped' }));
    }
    if (v.lastMove >= 0 && v.phase !== 'WAITING') {
      const p = reversi.pointOf(v.lastMove);
      parts.push(el('circle', { cx: cx(p.x), cy: cx(p.y), r: 1.1, class: 'last-move' }));
    }

    // RV-04, 6장: 내 차례에는 둘 수 있는 자리를 항상 점으로
    const mine = myColor();
    for (const m of moves) {
      if (hovered && m === hovered) continue;
      parts.push(
        el('circle', { cx: cx(m.x), cy: cx(m.y), r: 1.5, class: `legal ${mine}`, 'data-legal': '' }),
      );
    }
    if (hovered && mine) {
      parts.push(el('circle', { cx: cx(hovered.x), cy: cx(hovered.y), r: STONE_R, class: `ghost ${mine}` }));
      for (const f of hovered.flips)
        parts.push(el('circle', { cx: cx(f.x), cy: cx(f.y), r: 2.2, class: 'will-flip' }));
    }
    board.replaceChildren(...parts);
    board.classList.toggle('my-turn', moves.length > 0);
    const { black, white } = reversi.countStones(v.board);
    board.setAttribute(
      'aria-label',
      `리버시 판 8×8, 흑 ${black} 백 ${white}. ${turnText()}${moves.length > 0 ? `. 둘 수 있는 자리 ${moves.map(reversi.coordLabel).join(', ')}` : ''}`,
    );
  }

  function turnText(): string {
    const v = snap.view;
    if (v.phase === 'STARTING') return '곧 시작합니다';
    if (v.phase !== 'PLAYING') return '대국이 끝났습니다';
    if (v.currentTurn === snap.me) return '내 차례';
    const p = v.players.find((x) => x.id === v.currentTurn);
    return `${p?.nickname ?? ''} 님 차례`;
  }

  function playerCard(color: reversi.ReversiColor, count: number): HTMLElement {
    const v = snap.view;
    const p = v.players.find((x) => x.color === color);
    const active = v.phase === 'PLAYING' && p && v.currentTurn === p.id;
    const tags = [
      p?.id === snap.me
        ? h('span', { class: 'tag mine' }, active ? '내 차례' : '나')
        : active
          ? h('span', { class: 'tag' }, '차례')
          : null,
      p?.replaced || p?.autopilot ? h('span', { class: 'tag bot' }, '봇이 대신') : null,
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
        h('span', { class: 'rv-count', 'data-testid': `count-${color}` }, String(count)),
      ),
      timer,
      left,
    );
  }

  function drawPlayers(): void {
    const { black, white } = reversi.countStones(snap.view.board);
    players.replaceChildren(playerCard('black', black), playerCard('white', white));
  }

  function noticeContent(): { text: string; kind: string; icon: string } | null {
    const v = snap.view;
    if (v.phase !== 'PLAYING') return null;
    const name = (id: string) => v.players.find((x) => x.id === id)?.nickname ?? '';
    const now = Date.now();
    const n = snap.notice;
    const ev = snap.event;
    // 가장 최근 것 하나만 보인다
    const evAge = ev ? now - ev.at : Infinity;
    const nAge = n ? now - n.at : Infinity;
    if (ev && evAge < EVENT_MS && evAge <= nAge) {
      if (ev.kind === 'pass')
        return {
          text:
            ev.playerId === snap.me
              ? '둘 곳이 없어 차례를 넘겼어요'
              : `${name(ev.playerId)} 님이 둘 곳이 없어 차례를 넘겼어요`,
          kind: 'ok',
          icon: icons.history,
        };
      if (ev.playerId === snap.me) {
        const autopilot = me()?.autopilot;
        return {
          text: autopilot
            ? '봇이 대신 두고 있어요. 직접 두면 돌려받아요'
            : '시간이 지나 대신 뒀어요. 한 번 더 지나면 봇이 이어서 둡니다',
          kind: 'bot',
          icon: icons.robot,
        };
      }
    }
    if (n && n.playerId !== snap.me) {
      const p = v.players.find((x) => x.id === n.playerId);
      if (n.reason === 'left' && nAge < 8000)
        return { text: `${n.nickname} 님이 나가서 봇이 이어서 둡니다.`, kind: 'bot', icon: icons.robot };
      if (n.reason === 'disconnected' && p && !p.connected)
        return {
          text: `${n.nickname} 님 연결 끊김 · 시간이 지나면 대신 둡니다`,
          kind: 'off',
          icon: icons.wifiOff,
        };
      if (n.reason === 'returned' && nAge < 4000)
        return { text: `${n.nickname} 님이 다시 연결됐어요.`, kind: 'ok', icon: icons.link };
    }
    return null;
  }

  let noticeKey: string | null = null;
  function drawNotice(): void {
    const c = noticeContent();
    const key = c ? `${c.kind}|${c.text}` : '';
    if (key === noticeKey) return;
    noticeKey = key;
    notice.className = `gomoku-notice ${c?.kind ?? ''}`;
    notice.hidden = !c;
    notice.replaceChildren(...(c ? [svg(c.icon), c.text] : []));
  }

  function drawResult(): void {
    const v = snap.view;
    if (v.phase === 'STARTING') {
      result.hidden = false;
      result.className = 'gomoku-result starting';
      const color = myColor();
      result.replaceChildren(
        h('p', { class: 'result-title' }, '곧 시작합니다'),
        h('p', { class: 'hint' }, color ? `나는 ${color === 'black' ? '흑 (먼저 둬요)' : '백'}` : '관전 중'),
      );
      return;
    }
    if (v.phase !== 'GAME_OVER') {
      result.hidden = true;
      return;
    }
    const winner = v.players.find((p) => p.id === v.winnerId);
    const mine = myColor();
    const title =
      v.result === 'draw'
        ? '무승부'
        : !mine
          ? `${winner?.color === 'black' ? '흑' : '백'} 승리`
          : v.winnerId === snap.me
            ? '이겼어요'
            : '졌어요';
    const { black, white } = reversi.countStones(v.board);
    const score = h(
      'p',
      { class: 'rv-score', 'aria-label': `흑 ${black}, 백 ${white}` },
      h('span', {}, h('span', { class: 'stone-dot black' }), String(black)),
      h('span', { 'aria-hidden': 'true' }, ':'),
      h('span', {}, h('span', { class: 'stone-dot white' }), String(white)),
    );
    const again = h('button', { class: 'btn btn-primary', type: 'button' }, '다시 하기');
    again.addEventListener('click', () => session.send('rematch', {}));
    const leave = h('button', { class: 'btn', type: 'button' }, '나가기');
    leave.addEventListener('click', onExit);
    result.hidden = false;
    result.className = `gomoku-result ${v.winnerId && v.winnerId === snap.me ? 'win' : ''}`;
    result.replaceChildren(
      h('p', { class: 'result-title' }, title),
      score,
      h('p', { class: 'hint' }, `${v.moveCount}수 · 넘김 ${v.passCount}번`),
      h('div', { class: 'result-actions' }, leave, again),
    );
  }

  function paint(): void {
    drawBoard();
    drawPlayers();
    drawNotice();
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

  let lastFlipAt = 0;
  const off = session.subscribe((s) => {
    snap = s;
    // 새 차례가 시작되면 다시 둘 수 있다
    if (sentTurnId && s.view.turnId !== sentTurnId) sentTurnId = '';
    if (hover && s.view.board[reversi.indexOf(hover)] !== reversi.EMPTY) hover = null;
    paint();
    // 뒤집힌 돌 고리는 잠시 뒤 지운다
    if (s.flip && s.flip.at !== lastFlipAt) {
      lastFlipAt = s.flip.at;
      window.clearTimeout(flipTimer);
      flipTimer = window.setTimeout(drawBoard, FLIP_MARK_MS + 50);
    }
  });
  const noticeTimer = window.setInterval(drawNotice, 500);

  return () => {
    off();
    cancelAnimationFrame(raf);
    window.clearTimeout(flipTimer);
    window.clearInterval(noticeTimer);
  };
}
