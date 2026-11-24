import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nicknameKey, saveNickname, savedNickname } from '../src/identity.js';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

describe('게임별 닉네임 (ADR 0002)', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('게임마다 따로 저장하고 읽는다', () => {
    saveNickname('liars-dice', '주사위왕');
    expect(savedNickname('liars-dice')).toBe('주사위왕');
    expect(savedNickname('omok')).toBe('');
    saveNickname('omok', '오목신');
    expect(savedNickname('liars-dice')).toBe('주사위왕');
    expect(localStorage.getItem(nicknameKey('omok'))).toBe('오목신');
  });

  it('Phase 1 닉네임(wmg.nickname)은 거짓말쟁이 주사위로 한 번 옮기고 지운다', () => {
    localStorage.setItem('wmg.nickname', '예전닉');
    expect(savedNickname('omok')).toBe('');
    expect(savedNickname('liars-dice')).toBe('예전닉');
    expect(localStorage.getItem('wmg.nickname')).toBeNull();
    expect(localStorage.getItem('wmg.liars-dice.nickname')).toBe('예전닉');
  });

  it('게임 닉네임이 이미 있으면 예전 값은 건드리지 않는다', () => {
    localStorage.setItem('wmg.nickname', '예전닉');
    saveNickname('liars-dice', '새닉');
    expect(savedNickname('liars-dice')).toBe('새닉');
  });
});
