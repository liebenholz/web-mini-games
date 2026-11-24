import { bulls } from '@wmg/rules';
import { h, svg } from '../../dom.js';
import { icons } from '../../icons.js';
import type { BullsPlayerView, BullsSession, BullsSnapshot } from './session.js';

const URGENT_MS = 5000;
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
/** 메모판: 0 = ?, 1 = 없음, 2 = 있음 (8장) */
type Mark = 0 | 1 | 2;
const MARK_LABEL: Record<Mark, string> = { 0: '모름', 1: '없음', 2: '있음' };

/**
 * 숫자야구 게임 화면 (bulls-and-cows.md 8장, 시안 3~6).
 * 비밀 숫자 단계: 칸 + 키패드 + 무작위 / 추측 단계: 두 사람 카드, 내 비밀 숫자, 추측 기록, 메모판, 입력.
 * 키보드(0~9, Backspace, Enter)로도 입력할 수 있다.
 */
export function mountBullsGame(root: HTMLElement, session: BullsSession, onExit: () => void): () => void {
  let snap: BullsSnapshot = session.snapshot;
  let secretInput = '';
  let guessInput = '';
  let memo: Mark[] = DIGITS.map(() => 0);
  let lastPhase = '';
  let raf = 0;

  const exit = h('button', { class: 'btn btn-ghost back-link', type: 'button' }, svg(icons.back), '나가기');
  exit.addEventListener('click', () => {
    const playing =
      (snap.view.phase === 'PLAYING' || snap.view.phase === 'SECRET') && (me()?.seat ?? -1) >= 0;
    if (!playing || confirm('게임에서 나갈까요? 봇이 이어서 합니다.')) onExit();
  });
  const conn = h('span', { class: 'hint' });
  const right = h('span', { class: 'bc-right', 'data-testid': 'bc-status' });
  const statusbar = h('header', { class: 'statusbar oc-bar' }, exit, conn, right);
  const notice = h('div', { class: 'gomoku-notice', role: 'status', 'aria-live': 'polite', hidden: true });
  const body = h('div', { class: 'bc-body' });
  const result = h('div', { class: 'gomoku-result', hidden: true, 'data-testid': 'result' });
  root.replaceChildren(h('div', { class: 'bc' }, statusbar, notice, body, result));

  function me(): BullsPlayerView | undefined {
    return snap.view.players.find((p) => p.id === snap.me);
  }

  function seated(): BullsPlayerView[] {
    return snap.view.players.filter((p) => !p.spectator && p.seat >= 0).sort((a, b) => a.seat - b.seat);
  }

  function digits(): bulls.Digits {
    return snap.view.options.digits;
  }

  function myTurn(): boolean {
    const v = snap.view;
    return v.phase === 'PLAYING' && v.currentTurn === snap.me && Boolean(v.turnId);
  }

  // ───── 입력 (화면 키패드와 키보드가 같은 함수를 쓴다) ─────

  function type(d: string): void {
    if (snap.view.phase === 'SECRET' && !me()?.secretSet) {
      if (secretInput.length < digits() && !secretInput.includes(d)) secretInput += d;
    } else if (myTurn()) {
      if (guessInput.length < digits() && !guessInput.includes(d)) guessInput += d;
    } else return;
    paint();
  }

  function erase(all = false): void {
    if (snap.view.phase === 'SECRET') secretInput = all ? '' : secretInput.slice(0, -1);
    else guessInput = all ? '' : guessInput.slice(0, -1);
    paint();
  }

  function submit(): void {
    if (snap.view.phase === 'SECRET') {
      if (me()?.secretSet || secretInput.length !== digits()) return;
      session.send('set_secret', { digits: secretInput });
    } else if (myTurn() && guessInput.length === digits()) {
      session.send('guess', { digits: guessInput, turnId: snap.view.turnId });
      guessInput = '';
      paint();
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.target as HTMLElement | null)?.closest('input, textarea')) return;
    if (/^[0-9]$/.test(e.key)) type(e.key);
    else if (e.key === 'Backspace') erase();
    else if (e.key === 'Enter') submit();
    else return;
    e.preventDefault();
  }

  function slots(value: string, testid: string, small = false): HTMLElement {
    return h(
      'div',
      {
        class: `bc-slots${small ? ' small' : ''}`,
        'data-testid': testid,
        'aria-label': `입력 ${value || '없음'}`,
      },
      ...Array.from({ length: digits() }, (_, i) =>
        h(
          'span',
          { class: `bc-slot${i === value.length ? ' cur' : ''}${value[i] ? ' on' : ''}` },
          value[i] ?? '',
        ),
      ),
    );
  }

  function keypad(value: string, enabled: boolean, extra: HTMLElement[] = []): HTMLElement {
    const keys = DIGITS.map((d) => {
      const b = h(
        'button',
        {
          class: 'bc-key',
          type: 'button',
          'data-key': d,
          disabled: !enabled || value.includes(d) || value.length >= digits(),
        },
        d,
      );
      b.addEventListener('click', () => type(d));
      return b;
    });
    return h('div', { class: `bc-keys${extra.length ? ' six' : ''}` }, ...keys, ...extra);
  }

  // ───── 비밀 숫자 (시안 3) ─────

  function secretView(): HTMLElement {
    const m = me();
    const players = seated().map((p) =>
      h(
        'div',
        { class: 'bc-ready-row' },
        h('span', {}, p.id === snap.me ? `나(${p.nickname})` : p.nickname),
        h('span', { class: `pill ${p.secretSet ? 'ok' : 'wait'}` }, p.secretSet ? '정했어요' : '정하는 중'),
      ),
    );
    if (!m || m.seat < 0)
      return h(
        'section',
        { class: 'bc-secret' },
        h('p', { class: 'bc-title' }, '두 사람이 비밀 숫자를 정하는 중'),
        ...players,
      );
    if (m.secretSet)
      return h(
        'section',
        { class: 'bc-secret' },
        h('p', { class: 'bc-title' }, '비밀 숫자를 정했어요'),
        h(
          'p',
          { class: 'bc-mysecret big', 'data-testid': 'my-secret' },
          '내 숫자 ',
          h('b', {}, snap.secret || '•••'),
        ),
        h('p', { class: 'hint center' }, '상대가 정하면 바로 시작해요'),
        timerBar(),
        ...players,
      );
    const erase1 = h('button', { class: 'btn', type: 'button' }, '⌫ 지우기');
    erase1.addEventListener('click', () => erase());
    const random = h('button', { class: 'btn', type: 'button', 'data-testid': 'random-secret' }, '무작위로');
    random.addEventListener('click', () => session.send('random_secret', {}));
    const done = h(
      'button',
      {
        class: 'btn btn-primary btn-block',
        type: 'button',
        'data-testid': 'set-secret',
        disabled: secretInput.length !== digits(),
      },
      '정하기',
    );
    done.addEventListener('click', submit);
    return h(
      'section',
      { class: 'bc-secret' },
      h('p', { class: 'bc-title' }, '내 비밀 숫자를 정하세요'),
      h('p', { class: 'hint center' }, `0~9를 겹치지 않게 ${digits()}개 · 상대에게는 안 보여요`),
      timerBar(),
      slots(secretInput, 'secret-slots'),
      keypad(secretInput, true),
      h('div', { class: 'bc-row' }, erase1, random),
      done,
      ...players,
    );
  }

  function timerBar(): HTMLElement {
    return h('div', { class: 'oc-timer bc-timer', 'data-timer': '' }, h('i'));
  }

  // ───── 추측 (시안 4, 5) ─────

  function playView(): HTMLElement {
    const v = snap.view;
    const m = me();
    const amPlayer = Boolean(m && m.seat >= 0);
    const limit = v.options.maxAttempts;
    const cards = seated().map((p) => {
      const turn = v.phase === 'PLAYING' && v.currentTurn === p.id;
      const name = p.id === snap.me ? `나 (${p.nickname})` : p.nickname;
      const sub = [
        p.seat === 0 ? '선공' : '후공',
        `${p.attempts}번`,
        turn ? (p.id === snap.me ? '내 차례' : '차례') : '',
        p.replaced ? '봇이 대신' : p.autopilot ? '자동 진행' : !p.connected ? '연결 끊김' : '',
      ].filter(Boolean);
      return h(
        'div',
        { class: `bc-pc${turn ? ' turn' : ''}`, 'data-player': p.id },
        h('b', {}, name),
        h('small', {}, sub.join(' · ')),
      );
    });
    const nameOf = (id: string) =>
      id === snap.me ? '나' : (v.players.find((p) => p.id === id)?.nickname ?? '');
    const log = h(
      'ol',
      { class: 'bc-log', 'data-testid': 'guess-log', 'aria-label': '추측 기록' },
      ...v.history.map((g) => {
        const solved = !g.skipped && g.strikes === digits();
        const text = g.skipped ? '시간 초과' : bulls.formatScore(g, digits());
        const kind = g.skipped || (g.strikes === 0 && g.balls === 0) ? 'out' : solved ? 'win' : 's';
        return h(
          'li',
          { class: `bc-entry${g.playerId === snap.me ? ' me' : ''}` },
          h('span', { class: 'who' }, nameOf(g.playerId)),
          h('span', { class: 'n' }, g.skipped ? '—' : g.guess),
          h('span', { class: `res ${kind}` }, text),
        );
      }),
    );
    queueMicrotask(() => (log.scrollTop = log.scrollHeight));
    const parts: (HTMLElement | null)[] = [h('div', { class: 'bc-players' }, ...cards)];
    if (v.lastChance && v.phase === 'PLAYING') {
      const first = seated().find((p) => p.seat === 0);
      parts.push(
        h(
          'div',
          { class: 'bc-banner', 'data-testid': 'last-chance' },
          `${first?.id === snap.me ? '내가' : `${first?.nickname ?? ''} 님이`} 맞혔어요! 같은 횟수로 마지막 기회 · 맞히면 무승부`,
        ),
      );
    }
    if (amPlayer && snap.secret)
      parts.push(
        h(
          'p',
          { class: 'bc-mysecret', 'data-testid': 'my-secret' },
          '내 비밀 숫자 ',
          h('b', {}, snap.secret),
        ),
      );
    parts.push(log);
    if (amPlayer && v.phase === 'PLAYING') {
      parts.push(memoPad());
      const go = h(
        'button',
        {
          class: 'btn btn-primary bc-go',
          type: 'button',
          'data-testid': 'guess',
          disabled: !myTurn() || guessInput.length !== digits(),
        },
        '추측하기',
      );
      go.addEventListener('click', submit);
      const back = h('button', { class: 'bc-key fn', type: 'button', 'aria-label': '한 칸 지우기' }, '⌫');
      back.addEventListener('click', () => erase());
      const clear = h('button', { class: 'bc-key fn', type: 'button', 'aria-label': '모두 지우기' }, '전체');
      clear.addEventListener('click', () => erase(true));
      parts.push(
        h(
          'section',
          { class: 'bc-guessbar' },
          timerBar(),
          h(
            'p',
            { class: 'hint' },
            myTurn()
              ? `내 차례 · ${limit === 0 ? '시도 제한 없음' : `남은 시도 ${limit - (m?.attempts ?? 0)}번`}`
              : `${v.players.find((p) => p.id === v.currentTurn)?.nickname ?? '상대'} 님 차례`,
          ),
          h('div', { class: 'bc-row' }, slots(guessInput, 'guess-slots', true), go),
          keypad(guessInput, myTurn(), [back, clear]),
        ),
      );
    } else if (!amPlayer) {
      parts.push(h('p', { class: 'hint center' }, '관전 중이에요'));
    }
    return h('section', { class: 'bc-play' }, ...parts);
  }

  /** 8장: 누를 때마다 ? → 없음 → 있음. 내 화면 전용 (서버로 보내지 않는다) */
  function memoPad(): HTMLElement {
    const clear = h('button', { class: 'btn btn-ghost bc-memo-clear', type: 'button' }, '지우기');
    clear.addEventListener('click', () => {
      memo = DIGITS.map(() => 0);
      paint();
    });
    return h(
      'div',
      { class: 'bc-memo', 'data-testid': 'memo' },
      h('div', { class: 'bc-memo-head' }, h('span', {}, '메모 · 누를 때마다 ? → 없음 → 있음'), clear),
      h(
        'div',
        { class: 'bc-memo-keys' },
        ...DIGITS.map((d, i) => {
          const mark = memo[i] as Mark;
          const b = h(
            'button',
            {
              class: `bc-mark m${mark}`,
              type: 'button',
              'data-memo': d,
              'aria-label': `${d} ${MARK_LABEL[mark]}`,
            },
            d,
          );
          b.addEventListener('click', () => {
            memo[i] = (((memo[i] as Mark) + 1) % 3) as Mark;
            paint();
          });
          return b;
        }),
      ),
    );
  }

  // ───── 상태 표시와 결과 (시안 6) ─────

  function drawStatus(): void {
    const v = snap.view;
    const m = me();
    if (v.phase === 'SECRET')
      right.textContent = `남은 시간 ${Math.max(0, Math.ceil((v.phaseEndsAt - session.serverNow()) / 1000))}초`;
    else if (v.phase === 'PLAYING' || v.phase === 'GAME_OVER') {
      const limit = v.options.maxAttempts;
      const mine = m && m.seat >= 0 ? m.attempts : Math.max(0, ...seated().map((p) => p.attempts));
      right.textContent = limit === 0 ? `시도 ${mine}번` : `시도 ${mine}/${limit}`;
    } else right.textContent = '';
  }

  function drawNotice(): void {
    const n = snap.notice;
    const v = snap.view;
    let text = '';
    let kind = '';
    if (n && (v.phase === 'PLAYING' || v.phase === 'SECRET') && n.playerId !== snap.me) {
      const p = v.players.find((x) => x.id === n.playerId);
      const age = Date.now() - n.at;
      if (n.reason === 'left' && age < 8000) {
        text = `${n.nickname} 님이 나가서 봇이 이어서 합니다.`;
        kind = 'bot';
      } else if (n.reason === 'disconnected' && p && !p.connected) {
        text = `${n.nickname} 님 연결 끊김 · 차례가 오면 시간이 지나 넘어가요`;
        kind = 'off';
      } else if (n.reason === 'returned' && age < 4000) {
        text = `${n.nickname} 님이 다시 연결됐어요.`;
        kind = 'ok';
      }
    }
    notice.className = `gomoku-notice ${kind}`;
    notice.hidden = !text;
    notice.textContent = text;
  }

  function drawResult(): void {
    const v = snap.view;
    if (v.phase === 'STARTING') {
      result.hidden = false;
      result.className = 'gomoku-result starting';
      result.replaceChildren(
        h('p', { class: 'result-title' }, '곧 시작합니다'),
        h('p', { class: 'hint' }, `${v.options.digits}자리 · 비밀 숫자를 정할 준비를 하세요`),
      );
      return;
    }
    if (v.phase !== 'GAME_OVER') {
      result.hidden = true;
      return;
    }
    const m = me();
    const amPlayer = Boolean(m && m.seat >= 0);
    const winner = v.players.find((p) => p.id === v.winnerId);
    const title =
      v.result === 'draw'
        ? '무승부'
        : !amPlayer
          ? `${winner?.nickname ?? ''} 님 승리`
          : v.winnerId === snap.me
            ? '이겼어요!'
            : '졌어요';
    const anySolved = v.history.some((g) => !g.skipped && g.strikes === v.options.digits);
    const reason =
      v.result === 'draw'
        ? anySolved
          ? '둘 다 맞혔어요 (마지막 기회 성공)'
          : '둘 다 시도 안에 못 맞혔어요'
        : winner?.seat === 1
          ? '후공이 먼저 맞혀서 바로 승리'
          : '선공이 맞히고 후공이 마지막 기회를 놓쳤어요';
    const reveal = seated().map((p) =>
      h(
        'div',
        { class: `bc-reveal${p.id === v.winnerId ? ' w' : ''}` },
        h('b', {}, `${p.id === snap.me ? '내' : `${p.nickname}의`} 숫자 · ${p.attempts}번`),
        h('span', {}, p.revealed || snap.over?.secrets[p.id] || '—'),
      ),
    );
    const again = h('button', { class: 'btn btn-primary', type: 'button' }, '다시 하기');
    again.addEventListener('click', () => session.send('rematch', {}));
    const leave = h('button', { class: 'btn', type: 'button' }, '나가기');
    leave.addEventListener('click', onExit);
    result.hidden = false;
    result.className = `gomoku-result ${v.winnerId === snap.me ? 'win' : ''}`;
    result.replaceChildren(
      h('p', { class: 'result-title' }, title),
      h('p', { class: 'hint' }, reason),
      h('div', { class: 'bc-reveals', 'data-testid': 'reveal' }, ...reveal),
      h('div', { class: 'result-actions' }, leave, again),
    );
  }

  function paint(): void {
    const v = snap.view;
    if (v.phase !== lastPhase) {
      if (v.phase === 'SECRET') {
        secretInput = '';
        guessInput = '';
        memo = DIGITS.map(() => 0);
      }
      lastPhase = v.phase;
    }
    body.replaceChildren(
      v.phase === 'SECRET' ? secretView() : v.phase === 'STARTING' ? h('div') : playView(),
    );
    drawStatus();
    drawNotice();
    drawResult();
    conn.replaceChildren(snap.connection === 'online' ? '' : svg(icons.offline));
    tick();
  }

  function tick(): void {
    cancelAnimationFrame(raf);
    const v = snap.view;
    const bar = body.querySelector<HTMLElement>('[data-timer] i');
    if (bar) {
      let left = 0;
      let total = 1;
      if (v.phase === 'SECRET') {
        left = v.phaseEndsAt - session.serverNow();
        total = bulls.SECRET_MS;
      } else if (v.phase === 'PLAYING' && v.deadline > 0) {
        left = v.deadline - session.serverNow();
        total = v.options.turnSeconds * 1000;
      }
      left = Math.max(0, left);
      bar.style.transform = `scaleX(${Math.min(1, left / total)})`;
      bar.parentElement?.classList.toggle('urgent', left <= URGENT_MS || v.lastChance);
    }
    if (v.phase === 'SECRET') drawStatus();
    raf = requestAnimationFrame(tick);
  }

  const off = session.subscribe((s) => {
    const turnChanged = s.view.turnId !== snap.view.turnId;
    snap = s;
    if (turnChanged && !myTurn()) guessInput = '';
    paint();
  });
  document.addEventListener('keydown', onKey);
  const noticeTimer = window.setInterval(drawNotice, 1000);

  return () => {
    off();
    cancelAnimationFrame(raf);
    window.clearInterval(noticeTimer);
    document.removeEventListener('keydown', onKey);
  };
}
