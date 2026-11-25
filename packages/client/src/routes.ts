import { normalizeRoomCode } from '@wmg/rules';
import type { GameInfo } from './games/registry.js';

/**
 * 주소 체계 (ADR 0002)
 *   /                      메인: 게임 선택
 *   /<게임>                게임 로비
 *   /<게임>/r/<방 코드>    초대 링크
 *   /r/<방 코드>           Phase 1 초대 링크 → 거짓말쟁이 주사위
 *   /stats                 운영 통계 (docs/specs/stats.md)
 */
export type Route =
  | { readonly kind: 'hub' }
  | { readonly kind: 'stats' }
  | { readonly kind: 'lobby'; readonly game: GameInfo }
  /** code가 null이면 링크의 방 코드가 올바르지 않다 */
  | { readonly kind: 'invite'; readonly game: GameInfo; readonly code: string | null }
  | { readonly kind: 'coming-soon'; readonly game: GameInfo }
  | { readonly kind: 'not-found' };

export function parseRoute(pathname: string, games: readonly GameInfo[], legacyGameId: string): Route {
  const parts = pathname
    .split('/')
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
  if (parts.length === 0) return { kind: 'hub' };
  if (parts[0] === 'stats' && parts.length === 1) return { kind: 'stats' };

  const code = (raw: string | undefined) => normalizeRoomCode(raw ?? '');
  const legacy = games.find((g) => g.id === legacyGameId);
  if (parts[0] === 'r' && parts.length === 2 && legacy)
    return { kind: 'invite', game: legacy, code: code(parts[1]) };

  const game = games.find((g) => g.id === parts[0]);
  if (!game) return { kind: 'not-found' };
  const isLobby = parts.length === 1;
  const isInvite = parts.length === 3 && parts[1] === 'r';
  if (!isLobby && !isInvite) return { kind: 'not-found' };
  if (game.status !== 'available') return { kind: 'coming-soon', game };
  return isLobby ? { kind: 'lobby', game } : { kind: 'invite', game, code: code(parts[2]) };
}

export const STATS_PATH = '/stats';

export function lobbyPath(game: Pick<GameInfo, 'id'>): string {
  return `/${game.id}`;
}

export function invitePath(game: Pick<GameInfo, 'id'>, code: string): string {
  return `/${game.id}/r/${code}`;
}
