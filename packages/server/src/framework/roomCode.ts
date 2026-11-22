import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, roomCodeFromIndices } from '@wmg/rules';
import type { Rng } from './rng.js';

/**
 * 명세 4장: 6자리 방 코드 (0, O, 1, I 제외). 32^6 ≈ 10억 가지.
 * `isTaken`은 presence(로컬 또는 Redis)에서 사용 중인지 확인한다.
 */
export async function generateRoomCode(
  isTaken: (code: string) => Promise<boolean>,
  rng: Rng,
  maxAttempts = 20,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const indices = Array.from({ length: ROOM_CODE_LENGTH }, () => rng.int(ROOM_CODE_ALPHABET.length));
    const code = roomCodeFromIndices(indices);
    if (!(await isTaken(code))) return code;
  }
  throw new Error('could not allocate a unique room code');
}
