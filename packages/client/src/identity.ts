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

interface CryptoLike {
  getRandomValues(array: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>;
  randomUUID?: () => string;
}

/**
 * 무작위 UUID v4. `crypto.randomUUID`는 HTTPS나 localhost(보안 컨텍스트)에서만 있어서,
 * 같은 와이파이의 폰처럼 `http://192.168.x.x`로 열면 없다. 그때는 어디서나 되는 getRandomValues로 만든다
 */
export function newGuestId(c: CryptoLike = crypto): string {
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40; // 버전 4
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 변형
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let memoryGuest: string | null = null;

export function guestId(): string {
  const stored = safeGet(GUEST_KEY);
  if (stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) return stored;
  const id = memoryGuest ?? newGuestId();
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
