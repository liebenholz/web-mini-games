/**
 * 게스트 식별 (로그인 방식 미결정, 명세 12장).
 * 브라우저에 무작위 게스트 ID와 닉네임을 저장한다. 게스트 ID는 서버에만 보내고 다른 사람에게는 공개되지 않는다.
 */
const GUEST_KEY = 'wmg.guestId';
/** Phase 1의 닉네임 키. 게임이 하나였을 때 쓰던 값이라 거짓말쟁이 주사위 닉네임으로 옮긴다 (ADR 0002) */
const LEGACY_NICK_KEY = 'wmg.nickname';
/** Phase 1부터 있던 게임. 기존 /r/<코드> 초대 링크와 저장된 닉네임이 이 게임으로 이어진다 */
export const LEGACY_GAME_ID = 'liars-dice';

/** 닉네임은 게임마다 따로 저장한다. 게스트 ID는 모든 게임이 하나를 같이 쓴다 */
export function nicknameKey(gameId: string): string {
  return `wmg.${gameId}.nickname`;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 저장소를 쓸 수 없으면 지울 것도 없다
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

export function savedNickname(gameId: string): string {
  const own = safeGet(nicknameKey(gameId));
  if (own !== null) return own;
  if (gameId === LEGACY_GAME_ID) {
    const legacy = safeGet(LEGACY_NICK_KEY);
    if (legacy !== null) {
      safeSet(nicknameKey(gameId), legacy);
      safeRemove(LEGACY_NICK_KEY);
      return legacy;
    }
  }
  return '';
}

export function saveNickname(gameId: string, name: string): void {
  safeSet(nicknameKey(gameId), name);
}
