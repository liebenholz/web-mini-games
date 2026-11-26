import './styles/app.css';
import { h, mount, toast } from './dom.js';
import { SITE } from './games/catalog.js';
import { GAMES, LEGACY_GAME_ID, type GameInfo } from './games/registry.js';
import { savedNickname } from './identity.js';
import type { GameFlow, GameSession } from './games/flow.js';
import { installErrorReports, type ErrorContext } from './errorReport.js';
import { describeError, JoinError } from './joinErrors.js';
import { invitePath, lobbyPath, parseRoute } from './routes.js';
import { renderHub } from './screens/hub.js';
import { renderLobby } from './screens/lobby.js';
import { renderStats } from './screens/stats.js';
import { fetchStats, recordVisit } from './statsApi.js';

/**
 * 라우트 (ADR 0002): / 메인(게임 선택), /<게임> 로비, /<게임>/r/<코드> 초대 링크, /r/<코드> 이전 초대 링크.
 * 방에 들어가면 주소를 초대 링크로 바꿔, 새로고침해도 같은 게스트 ID로 자리를 되찾는다 (TC-16).
 */
let session: GameSession | null = null;
let teardown: (() => void) | null = null;

const flows = new Map<string, Promise<GameFlow>>();

/** 플레이할 수 있는 게임은 registry에 연결과 화면(flow)이 있다. 처음 부를 때 받아 두고 다시 쓴다 */
function flowOf(game: GameInfo): Promise<GameFlow> {
  if (!game.loadFlow) return Promise.reject(new Error(`no flow for ${game.id}`));
  let flow = flows.get(game.id);
  if (!flow) {
    flow = game.loadFlow();
    // 받기에 실패하면 다음에 다시 받는다
    flow.catch(() => flows.delete(game.id));
    flows.set(game.id, flow);
  }
  return flow;
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
  // 로비를 보는 동안 그 게임 코드를 미리 받는다
  void flowOf(game).catch(() => undefined);
  mount(
    renderLobby(
      game,
      {
        create: async (n) => (await flowOf(game)).create(n),
        join: async (c, n) => (await flowOf(game)).join(c, n),
        quickMatch: async (n) => (await flowOf(game)).quickMatch(n),
        entered: (s) => void flowOf(game).then((flow) => enter(game, s, flow)),
        back: () => navigate('/'),
      },
      code,
      notice,
    ),
  );
}

function showStats(): void {
  teardown?.();
  document.title = `통계 · ${SITE.name}`;
  const view = renderStats({ load: fetchStats, back: () => navigate('/') });
  teardown = view.dispose;
  mount(view.node);
}

function exitToLobby(game: GameInfo, notice: string | null = null): void {
  const s = session;
  session = null;
  void s?.leave();
  history.pushState(null, '', lobbyPath(game));
  showLobby(game, null, notice);
}

function enter(game: GameInfo, s: GameSession, flow: GameFlow): void {
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
  teardown = flow.mount(s, { exit: () => exitToLobby(game) });
}

async function boot(): Promise<void> {
  const route = parseRoute(location.pathname, GAMES, LEGACY_GAME_ID);
  switch (route.kind) {
    case 'hub':
      showHub();
      return;
    case 'stats':
      showStats();
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
  const nickname = savedNickname();
  if (nickname) {
    // 초대 링크 + 저장한 닉네임 → 바로 입장 (재방문·새로고침 포함)
    mount(
      h('main', { class: 'page narrow centered' }, h('div', { class: 'spinner', 'aria-label': '입장 중' })),
    );
    try {
      const flow = await flowOf(game);
      enter(game, await flow.join(code, nickname), flow);
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

// CE-02: 오류가 난 화면 종류와 게임 (주소에서 읽는다. 방 안에서는 주소가 초대 링크다)
function errorContext(): ErrorContext {
  const route = parseRoute(location.pathname, GAMES, LEGACY_GAME_ID);
  switch (route.kind) {
    case 'stats':
      return { route: 'stats', game: null };
    case 'lobby':
      return { route: 'lobby', game: route.game.roomType };
    case 'invite':
      return { route: 'room', game: route.game.roomType };
    default:
      return { route: 'hub', game: null };
  }
}
installErrorReports(errorContext);

// ST-01: 하루 한 번 방문을 알린다. 통계 화면만 연 것은 세지 않는다
if (parseRoute(location.pathname, GAMES, LEGACY_GAME_ID).kind !== 'stats') recordVisit();

void boot().catch(() => toast(describeError('NETWORK')));
