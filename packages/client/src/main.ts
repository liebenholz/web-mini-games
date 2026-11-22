import './styles/app.css';
import { normalizeRoomCode } from '@wmg/rules';
import { h, mount, toast } from './dom.js';
import { savedNickname } from './identity.js';
import { describeError, JoinError, Session } from './net.js';
import { mountGame } from './screens/game.js';
import { renderLobby } from './screens/lobby.js';
import { renderWaiting } from './screens/waiting.js';

/**
 * 라우트 (M4): /, /liars-dice → 로비, /r/:code → 초대 링크로 바로 대기실.
 * 방에 들어가면 주소를 /r/:code로 바꿔 새로고침해도 같은 게스트 ID로 자리를 되찾는다 (TC-16).
 */
let session: Session | null = null;
let teardown: (() => void) | null = null;
let screen: 'waiting' | 'game' | null = null;

function inviteCodeFromPath(): string | null {
  const match = /^\/r\/([^/]+)\/?$/.exec(location.pathname);
  return match ? normalizeRoomCode(decodeURIComponent(match[1] ?? '')) : null;
}

function showLobby(code: string | null = null, notice: string | null = null): void {
  teardown?.();
  teardown = null;
  screen = null;
  mount(
    renderLobby(
      {
        create: (n) => Session.create(n, {}),
        join: (c, n) => Session.join(c, n),
        quickMatch: (n) => Session.quickMatch(n),
        entered: enter,
      },
      code,
      notice,
    ),
  );
}

function exitToLobby(notice: string | null = null): void {
  const s = session;
  session = null;
  void s?.leave();
  history.pushState(null, '', '/');
  showLobby(null, notice);
}

function enter(s: Session): void {
  session = s;
  const code = s.snapshot.view.roomCode || s.room.roomId;
  if (location.pathname !== `/r/${code}`) history.replaceState(null, '', `/r/${code}`);
  s.onClosed((reason) => {
    if (session !== s) return;
    session = null;
    teardown?.();
    teardown = null;
    history.replaceState(null, '', '/');
    showLobby(null, reason ? describeError(reason) : '방이 닫혔습니다.');
  });
  s.subscribe((snap) => {
    if (session !== s) return;
    const want = snap.view.phase === 'WAITING' ? 'waiting' : 'game';
    if (want === 'waiting') {
      teardown?.();
      teardown = null;
      screen = 'waiting';
      mount(renderWaiting(s, snap, () => exitToLobby()));
    } else if (screen !== 'game') {
      teardown?.();
      screen = 'game';
      const root = h('div');
      mount(root);
      teardown = mountGame(root, s, () => exitToLobby());
    }
  });
}

async function boot(): Promise<void> {
  const code = inviteCodeFromPath();
  if (location.pathname.startsWith('/r/') && !code) {
    showLobby(null, '초대 링크의 방 코드가 올바르지 않습니다.');
    return;
  }
  const nickname = savedNickname();
  if (code && nickname) {
    // 초대 링크 + 저장된 닉네임 → 바로 입장 (재방문·새로고침 포함)
    mount(
      h('main', { class: 'page narrow centered' }, h('div', { class: 'spinner', 'aria-label': '입장 중' })),
    );
    try {
      enter(await Session.join(code, nickname));
      return;
    } catch (e) {
      showLobby(code, describeError(e instanceof JoinError ? e.code : 'NETWORK'));
      return;
    }
  }
  showLobby(code);
}

window.addEventListener('popstate', () => {
  if (!session) void boot();
});

// 앱 전환 후 복귀(TC-16): 연결이 끊겨 있으면 SDK가 자동 재연결한다. 완전히 닫혔으면 링크로 다시 들어간다.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !session && inviteCodeFromPath()) void boot();
});

void boot().catch(() => toast(describeError('NETWORK')));
