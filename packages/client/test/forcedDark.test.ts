import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

/**
 * 화면은 밝은 테마 하나뿐이다. 브라우저의 강제 다크 모드(Chrome 자동 어둡게, 다크 리더)가
 * 오목 흑돌을 밝게 뒤집어 흑백이 구분되지 않았다. 강제 다크를 끄도록 선언한다
 */
describe('강제 다크 모드 끄기', () => {
  it('index.html은 color-scheme을 only light로 선언하고 다크 리더를 잠근다', () => {
    const html = read('../index.html');
    expect(html).toMatch(/<meta name="color-scheme" content="only light"/);
    expect(html).toMatch(/<meta name="darkreader-lock"/);
  });

  it('CSS 루트도 only light다', () => {
    expect(read('../src/styles/tokens.css')).toMatch(/color-scheme:\s*only light;/);
  });
});
