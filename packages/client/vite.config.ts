import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { CATALOG, SITE } from './src/games/catalog.js';

/**
 * 링크 미리보기 (Open Graph). 카카오톡·디스코드는 스크립트를 실행하지 않아서 주소마다 HTML에 직접 적어야 한다.
 * 메인은 index.html, 게임은 <게임>.html을 만들어 제목과 설명만 바꾼다.
 * 이미지는 절대 주소여야 해서 배포할 때 SITE_URL(예: https://wmg-play.pages.dev)을 넘긴다.
 */
function linkPreviews(): Plugin {
  const siteUrl = (process.env.SITE_URL ?? '').replace(/\/+$/, '');
  const meta = (title: string, description: string, path: string) => {
    const url = siteUrl ? `${siteUrl}${path}` : path;
    const image = siteUrl ? `${siteUrl}/og.png` : '/og.png';
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    return [
      `<title>${esc(title)}</title>`,
      `<meta name="description" content="${esc(description)}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:site_name" content="${esc(`${SITE.name} · ${SITE.fullName}`)}" />`,
      `<meta property="og:title" content="${esc(title)}" />`,
      `<meta property="og:description" content="${esc(description)}" />`,
      `<meta property="og:url" content="${esc(url)}" />`,
      `<meta property="og:image" content="${esc(image)}" />`,
      `<meta property="og:image:width" content="1200" />`,
      `<meta property="og:image:height" content="630" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
    ].join('\n    ');
  };
  const MARKER = '<!-- link-preview -->';
  return {
    name: 'wmg-link-previews',
    // Vite가 index.html을 만든 뒤에 게임별 HTML을 만든다
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(MARKER, meta(`${SITE.name} · ${SITE.fullName}`, SITE.description, '/'));
    },
    generateBundle(_options, bundle) {
      const index = bundle['index.html'];
      if (!index || index.type !== 'asset') return;
      const html = String(index.source);
      const hubTitle = `${SITE.name} · ${SITE.fullName}`;
      for (const game of CATALOG) {
        if (game.status !== 'available') continue;
        const start = html.indexOf('<title>');
        const end = html.indexOf('<meta name="twitter:card"');
        if (start < 0 || end < 0 || !html.includes(hubTitle)) continue;
        const tail = html.indexOf('/>', end) + 2;
        const source =
          html.slice(0, start) +
          meta(
            `${game.name} · ${SITE.name}`,
            `${game.tagline} · ${game.players} · ${game.minutes}`,
            `/${game.id}`,
          ) +
          html.slice(tail);
        this.emitFile({ type: 'asset', fileName: `${game.id}.html`, source });
      }
      // Cloudflare Pages 주소 규칙. <게임>.html은 Pages가 /<게임>으로 바로 내준다 (정적 파일이 규칙보다 먼저).
      // 그 아래 주소(초대 링크)와 기존 /r/<코드>는 /<게임>으로 다시 쓴다. 폴더(<게임>/index.html)로 두면
      // Pages가 /<게임>/로 308 리다이렉트를 걸어 규칙과 꼬였다
      const available = CATALOG.filter((g) => g.status === 'available');
      const rules = [...available.map((g) => `/${g.id}/* /${g.id} 200`), '/r/* /liars-dice 200', '/* / 200'];
      this.emitFile({ type: 'asset', fileName: '_redirects', source: `${rules.join('\n')}\n` });
    },
  };
}

export default defineConfig({
  plugins: [linkPreviews()],
  resolve: {
    alias: { '@wmg/rules': fileURLToPath(new URL('../rules/src/index.ts', import.meta.url)) },
  },
  server: { port: 5173, host: true },
  build: {
    target: 'es2022',
    // Phaser는 게임 화면에서만 불러온다 (로비 첫 로딩을 가볍게)
    chunkSizeWarningLimit: 1600,
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
