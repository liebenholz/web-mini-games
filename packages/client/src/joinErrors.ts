/**
 * 방 만들기·입장 실패와 닫힘 이유를 사용자 문구로 바꾼다. 연결 라이브러리(Colyseus SDK)를 import하지 않아
 * 메인·로비 화면이 SDK 없이 뜬다 (ADR 0003: 게임 코드는 그 게임에 들어갈 때 받는다)
 */
import { CLOSE_CODES, type ErrorCode } from '@wmg/rules';
import { reportClientError } from './errorReport.js';

export class JoinError extends Error {
  constructor(readonly code: ErrorCode | 'NETWORK') {
    super(code);
  }
}

/** 서버가 보낸 거부 메시지를 사용자 문구로 */
export function describeError(code: string): string {
  const map: Record<string, string> = {
    ROOM_NOT_FOUND: '방을 찾을 수 없습니다. 코드를 다시 확인해 주세요.',
    ROOM_FULL: '방이 가득 찼습니다.',
    INVALID_NICKNAME: '닉네임은 2~12자로 입력해 주세요.',
    INVALID_OPTIONS: '방 옵션이 올바르지 않습니다.',
    SERVER_DRAINING: '서버 점검 중입니다. 잠시 후 다시 시도해 주세요.',
    DUPLICATE_SESSION: '다른 탭에서 같은 계정으로 접속해 이 화면을 닫았습니다.',
    KICKED: '방장이 이 방에서 내보냈습니다. 이 방에는 다시 들어갈 수 없습니다.',
    NOT_YOUR_TURN: '내 차례가 아닙니다.',
    STALE_TURN: '이미 지난 차례입니다.',
    INVALID_MOVE: '판 밖에는 둘 수 없습니다.',
    OCCUPIED: '이미 돌이 있는 자리입니다.',
    FORBIDDEN_MOVE: '흑은 이 자리에 둘 수 없습니다 (금수).',
    INVALID_CARD: '지금 낼 수 없는 카드입니다.',
    INVALID_SUIT: '모양을 다시 골라 주세요.',
    INVALID_GUESS: '0~9 숫자를 겹치지 않게 자릿수만큼 넣어 주세요.',
    RATE_LIMITED: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
    NETWORK: '서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.',
  };
  return map[code] ?? '요청을 처리하지 못했습니다.';
}

/** 연결 종료 코드 → 사용자 문구용 코드. 4001~4003은 서버가 정한 종료 코드 (rules CLOSE_CODES), 그 밖의 비정상 종료는 재연결 실패로 본다 */
export function closeReason(code: number): string | null {
  if (code === CLOSE_CODES.DUPLICATE_SESSION) return 'DUPLICATE_SESSION';
  if (code === CLOSE_CODES.RATE_LIMITED) return 'RATE_LIMITED';
  if (code === CLOSE_CODES.KICKED) return 'KICKED';
  return code === 1000 ? null : 'NETWORK';
}

/**
 * 방 만들기·입장 실패를 JoinError로 바꾼다. 네트워크나 알 수 없는 이유면 오류로 보고한다 (CE-01 connect_failed).
 * 서버가 정상적으로 거절한 것(ROOM_NOT_FOUND, ROOM_FULL, KICKED …)은 보고하지 않는다
 */
export function joinFailure(error: unknown): JoinError {
  const joinError = error instanceof JoinError ? error : toJoinError(error);
  if (joinError.code === 'NETWORK') {
    reportClientError('connect_failed', error instanceof JoinError ? 'join timeout' : error);
  }
  return joinError;
}

export function toJoinError(error: unknown): JoinError {
  const message = error instanceof Error ? error.message : String(error);
  const known = [
    'ROOM_FULL',
    'INVALID_NICKNAME',
    'INVALID_OPTIONS',
    'INVALID_MESSAGE',
    'SERVER_DRAINING',
    'KICKED',
  ] as const;
  for (const code of known) if (message.includes(code)) return new JoinError(code);
  const code = (error as { code?: number }).code;
  if (code === 404 || code === 4212 || /not found|invalid room|room .* not/i.test(message))
    return new JoinError('ROOM_NOT_FOUND');
  return new JoinError('NETWORK');
}
