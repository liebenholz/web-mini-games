/**
 * 게스트 식별 (로그인 방식 미결정, 명세 12장).
 * 브라우저에 무작위 게스트 ID와 닉네임을 저장한다. 게스트 ID는 서버에만 보내고 다른 사람에게는 공개되지 않는다.
 */
const GUEST_KEY = 'wmg.guestId';
const NICK_KEY = 'wmg.nickname';

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 사파리 비공개 모드 등: 이번 세션 동안만 메모리에 둔다
  }
}

let memoryGuest: string | null = null;

export function guestId(): string {
  const stored = safeGet(GUEST_KEY);
  if (stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) return stored;
  const id = memoryGuest ?? crypto.randomUUID();
  memoryGuest = id;
  safeSet(GUEST_KEY, id);
  return id;
}

export function savedNickname(): string {
  return safeGet(NICK_KEY) ?? '';
}

export function saveNickname(name: string): void {
  safeSet(NICK_KEY, name);
}
