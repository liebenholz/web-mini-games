import { describe, expect, it } from 'vitest';
import { heroIcons } from '../src/screens/lobby.js';

describe('로비 머리 장식', () => {
  it('판 게임(오목)은 주사위가 아니라 판 위 돌 1→5개다', () => {
    const icons = heroIcons({ category: 'board' });
    expect(icons).toHaveLength(5);
    icons.forEach((svg, i) => expect(svg.match(/<circle/g)?.length).toBe(i + 1));
    expect(icons.join('')).not.toMatch(/r="1.9"/); // 주사위 눈 아님
  });

  it('주사위 게임은 그대로 주사위다', () => {
    expect(heroIcons({ category: 'dice' }).join('')).toMatch(/r="1.9"/);
  });
});
