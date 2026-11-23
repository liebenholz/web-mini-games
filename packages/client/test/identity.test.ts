import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { newGuestId } from '../src/identity.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('게스트 ID', () => {
  it('보안 컨텍스트가 아니어서 randomUUID가 없어도 UUID v4를 만든다 (같은 와이파이의 폰, http://192.168.x.x)', () => {
    const insecure = { getRandomValues: (a: Uint8Array<ArrayBuffer>) => webcrypto.getRandomValues(a) };
    const ids = new Set(Array.from({ length: 200 }, () => newGuestId(insecure)));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });

  it('randomUUID가 있으면 그것을 쓴다', () => {
    const secure = {
      getRandomValues: (a: Uint8Array<ArrayBuffer>) => webcrypto.getRandomValues(a),
      randomUUID: () => '00000000-0000-4000-8000-000000000000',
    };
    expect(newGuestId(secure)).toBe('00000000-0000-4000-8000-000000000000');
  });
});
