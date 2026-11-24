import { describe, expect, it } from 'vitest';
import { renderScale } from '../src/game/renderScale.js';

describe('캔버스 픽셀 배율', () => {
  it('화면 밀도를 그대로 쓰되 1~3 사이로 자른다', () => {
    expect(renderScale(1)).toBe(1);
    expect(renderScale(2)).toBe(2);
    expect(renderScale(2.625)).toBe(2.625); // 안드로이드 기기에 흔한 값
    expect(renderScale(4)).toBe(3);
    expect(renderScale(0.5)).toBe(1);
    expect(renderScale(Number.NaN)).toBe(1);
  });
});
