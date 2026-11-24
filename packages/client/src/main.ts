import './styles/app.css';
import { h, mount, toast } from './dom.js';
import { SITE } from './games/catalog.js';
import { GAMES, LEGACY_GAME_ID, type GameInfo } from './games/registry.js';
import { savedNickname } from './identity.js';
import type { GameFlow, GameSession } from './games/flow.js';
import { describeError, JoinError } from './net.js';
import { invitePath, lobbyPath, parseRoute } from './routes.js';
import { renderHub } from './screens/hub.js';
import { renderLobby } from './screens/lobby.js';

/**
 * 라우트 (ADR 0002): / 메인(게임 선택), /<게임> 로비, /<게임>/r/<코드> 초대 링크, /r/<코드> 이전 초대 링크.
 * 방에 들어가면 주소를 초대 링크로 바꿔, 새로고침해도 같은 게스트 ID로 자리를 되찾는다 (TC-16).
 */
let session: GameSession | null = null;
let teardown: (() => void) | null = null;

/** 플레이할 수 있는 게임은 registry에 연결과 화면(flow)이 있다 */
function flowOf(game: GameInfo): GameFlow {
  if (!game.flow) throw new Error(`no flow for ${game.id}`);
  return game.flow;
}

function setTitle(game: GameInfo | null): void {
  document.title = game ? `${game.name} · ${SITE.name}` : `${SITE.name} · ${SITE.fullName}`;
}

function navigate(path: string): void {
  if (location.pathname !== path) history.pushState(null, '', path);
  void boot();
}

function showHub(notice: string | null = null): void {
  teardown?.();
  teardown = null;
  setTitle(null);
  mount(renderHub(GAMES, (game) => navigate(lobbyPath(game))));
  if (notice) toast(notice);
}

function showLobby(game: GameInfo, code: string | null = null, notice: string | null = null): void {
  teardown?.();
  teardown = null;
  setTitle(game);
  const flow = flowOf(game);
  mount(
    renderLobby(
      game,
      {
        create: (n) => flow.create(n),
        join: (c, n) => flow.join(c, n),
        quickMatch: (n) => flow.quickMatch(n),
        entered: (s) => enter(game, s),
        back: () => navigate('/'),
      },
      code,
      notice,
    ),
  );
}

function exitToLobby(game: GameInfo, notice: string | null = null): void {
  const s = session;
  session = null;
  void s?.leave();
  history.pushState(null, '', lobbyPath(game));
  showLobby(game, null, notice);
}

function enter(game: GameInfo, s: GameSession): void {
  session = s;
  const path = invitePath(game, s.roomCode);
  if (location.pathname !== path) history.replaceState(null, '', path);
  s.onClosed((reason) => {
    if (session !== s) return;
    session = null;
    teardown?.();
    teardown = null;
    history.replaceState(null, '', lobbyPath(game));
    showLobby(game, null, reason ? describeError(reason) : '방이 닫혔습니다.');
  });
  teardown = flowOf(game).mount(s, { exit: () => exitToLobby(game) });
}

async function boot(): Promise<void> {
  const route = parseRoute(location.pathname, GAMES, LEGACY_GAME_ID);
  switch (route.kind) {
    case 'hub':
      showHub();
      return;
    case 'not-found':
      history.replaceState(null, '', '/');
      showHub('찾는 페이지가 없어 게임 목록으로 왔습니다.');
      return;
    case 'coming-soon':
      history.replaceState(null, '', '/');
      showHub(`준비 중인 게임입니다 (${route.game.name}).`);
      return;
    case 'lobby':
      showLobby(route.game);
      return;
    case 'invite':
      break;
  }

  const { game, code } = route;
  if (!code) {
    showLobby(game, null, '초대 링크의 방 코드가 올바르지 않습니다.');
    return;
  }
  const nickname = savedNickname(game.id);
  if (nickname) {
    // 초대 링크 + 이 게임에서 저장한 닉네임 → 바로 입장 (재방문·새로고침 포함)
    mount(
      h('main', { class: 'page narrow centered' }, h('div', { class: 'spinner', 'aria-label': '입장 중' })),
    );
    try {
      enter(game, await flowOf(game).join(code, nickname));
      return;
    } catch (e) {
      showLobby(game, code, describeError(e instanceof JoinError ? e.code : 'NETWORK'));
      return;
    }
  }
  showLobby(game, code);
}

window.addEventListener('popstate', () => {
  if (!session) void boot();
});

// 앱 전환 후 복귀(TC-16): 연결이 끊겨 있으면 SDK가 자동 재연결한다. 완전히 닫혔으면 링크로 다시 들어간다.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || session) return;
  if (parseRoute(location.pathname, GAMES, LEGACY_GAME_ID).kind === 'invite') void boot();
});

void boot().catch(() => toast(describeError('NETWORK')));
