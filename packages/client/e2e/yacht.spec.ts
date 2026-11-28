import { expect, test, type Page } from '@playwright/test';

/** 요트 방을 만들고 봇과 시작한다 (E2E 서버는 시간 배율 0.05). 턴 60초 = 3초 */
async function startVsBots(page: Page, maxPlayers = '2') {
  await page.addInitScript(() => localStorage.setItem('wmg.nickname', '요트테스터'));
  await page.goto('/yacht');
  await page.getByRole('button', { name: '방 만들기' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
  await expect(page).toHaveURL(/\/yacht\/r\/[A-HJ-NP-Z2-9]{6}$/);
  await page
    .getByRole('group', { name: '최대 인원' })
    .getByRole('button', { name: maxPlayers, exact: true })
    .click();
  const time = page.getByRole('group', { name: '턴 제한(초) · 넘기면 대신 기록해요' });
  await time.getByRole('button', { name: '60' }).click();
  await expect(time.getByRole('button', { name: '60' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '게임 시작' }).click();
  await expect(page.locator('.yt-sheet')).toBeVisible({ timeout: 15_000 });
}

test('메인에서 요트 주사위를 골라 로비로 간다 (주사위 카테고리, 2~4명)', async ({ page }) => {
  await page.goto('/');
  const card = page.getByTestId('game-yacht');
  await expect(card).toContainText('주사위 5개로 12칸을 채워 점수를 겨뤄요');
  await expect(card).toContainText('2~4명');
  await card.getByRole('button', { name: '요트 주사위 규칙 보기' }).click();
  await expect(page.getByRole('dialog', { name: '요트 주사위 규칙' })).toContainText('12개의 칸을 채우고');
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: '요트 주사위 하러 가기' }).click();
  await expect(page).toHaveURL(/\/yacht$/);
});

test('대기실: 옵션 요약과 인원 2~4 선택', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wmg.nickname', '방장'));
  await page.goto('/yacht');
  await page.getByRole('button', { name: '방 만들기' }).click();
  const summary = page.getByTestId('options-summary');
  await expect(summary).toContainText('최대 2명 · 턴 45초');
  await page
    .getByRole('group', { name: '최대 인원' })
    .getByRole('button', { name: '4', exact: true })
    .click();
  await expect(summary).toContainText('최대 4명');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('4명 360px: 점수표 전체와 굴리기·기록 버튼이 가로로 넘치지 않는다', async ({ page }) => {
  await startVsBots(page, '4');
  await expect(page.locator('.yt-players .yt-p')).toHaveCount(4);
  await expect(page.locator('.yt-sheet tbody tr')).toHaveCount(15);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // 내 차례가 오면 굴리기 버튼이 보이고, 굴린 뒤 점수표에 점수 미리보기가 생긴다
  const roll = page.getByTestId('yt-roll');
  await expect(roll).toBeVisible({ timeout: 20_000 });
  await expect(roll).toBeInViewport({ ratio: 1 });
});

test('YA: 사람 1명 + 봇으로 굴리고 고정하고 기록해 끝까지 간다', async ({ page }) => {
  await startVsBots(page);
  const roll = page.getByTestId('yt-roll');
  const result = page.getByTestId('result');
  // 내 차례가 올 때마다 한 번 굴려 기록한다. 나머지 차례는 시간 초과·봇에 맡긴다
  let recorded = 0;
  const fastClick = (loc: ReturnType<Page['locator']>) =>
    loc.click({ timeout: 700 }).then(
      () => true,
      () => false,
    );
  for (let i = 0; i < 600 && !(await result.isVisible()); i += 1) {
    const rc = await roll.count();
    if (recorded < 3 && rc > 0 && (await fastClick(roll))) {
      if (await fastClick(page.locator('[data-testid^="yt-cell-"]').first())) {
        const rec = page.getByTestId('yt-record');
        if ((await rec.count()) > 0 && (await rec.textContent())?.includes('기록') && (await fastClick(rec)))
          recorded += 1;
      }
    }
    await page.waitForTimeout(100);
  }
  await expect(result).toBeVisible({ timeout: 120_000 });
  await expect(result).toContainText(/\d위/);
  await expect(page.locator('.yt-rank .row')).toHaveCount(2);
  expect(recorded).toBeGreaterThan(0);
  await page.getByRole('button', { name: '다시 하기' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
});

test('PC: 키보드로 굴리고(R) 칸을 고르고(↓) 기록한다(Enter)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await startVsBots(page);
  const roll = page.getByTestId('yt-roll');
  await expect(roll).toBeEnabled({ timeout: 20_000 });
  await page.keyboard.press('r');
  await expect(page.locator('[data-testid^="yt-cell-"]').first()).toBeVisible({ timeout: 3_000 });
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('yt-record')).toContainText('기록');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid^="yt-cell-"]')).toHaveCount(0, { timeout: 5_000 });
});
