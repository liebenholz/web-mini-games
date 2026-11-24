import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NICKNAME_KEY, saveNickname, savedNickname } from '../src/identity.js';

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

describe('공용 닉네임 (ADR 0002 개정)', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('한 번 저장하면 모든 게임 로비에서 같은 닉네임을 쓴다', () => {
    expect(savedNickname()).toBe('');
    saveNickname('카드왕');
    expect(savedNickname()).toBe('카드왕');
    expect(localStorage.getItem(NICKNAME_KEY)).toBe('카드왕');
    expect(NICKNAME_KEY).toBe('wmg.nickname');
  });

  it('게임별로 저장해 둔 닉네임은 처음 읽을 때 공용으로 옮기고 지운다 (주사위 → 오목 → 원카드 순서)', () => {
    localStorage.setItem('wmg.gomoku.nickname', '오목신');
    localStorage.setItem('wmg.liars-dice.nickname', '주사위왕');
    expect(savedNickname()).toBe('주사위왕');
    expect(localStorage.getItem('wmg.nickname')).toBe('주사위왕');
    expect(localStorage.getItem('wmg.liars-dice.nickname')).toBeNull();
    expect(localStorage.getItem('wmg.gomoku.nickname')).toBeNull();
  });

  it('공용 닉네임이 이미 있으면 그 값을 쓰고 게임별 값은 지운다', () => {
    localStorage.setItem('wmg.nickname', '공용닉');
    localStorage.setItem('wmg.one-card.nickname', '원카드닉');
    expect(savedNickname()).toBe('공용닉');
    expect(localStorage.getItem('wmg.one-card.nickname')).toBeNull();
  });

  it('Phase 1에 저장한 wmg.nickname은 그대로 공용 닉네임이다', () => {
    localStorage.setItem('wmg.nickname', '예전닉');
    expect(savedNickname()).toBe('예전닉');
  });
});
