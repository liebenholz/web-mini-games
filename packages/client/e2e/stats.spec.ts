import { expect, test } from '@playwright/test';

test('ST-01, ST-03: 메인을 열면 방문이 잡히고, /stats에서 그래프와 기간을 본다', async ({ page }) => {
  const visit = page.waitForResponse(
    (res) => res.url().endsWith('/visit') && res.request().method() === 'POST',
  );
  await page.goto('/');
  expect((await visit).status()).toBe(200);

  await page.goto('/stats');
  const visitors = page.getByTestId('today-visitors');
  await expect(visitors).toBeVisible();
  expect(
    Number((await visitors.locator('.stat-value').textContent())?.replace(/,/g, '')),
  ).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId('chart-people').locator('svg')).toBeVisible();
  await expect(page.getByTestId('chart-games').locator('svg')).toBeVisible();
  // 기본 30일
  await expect(
    page.getByRole('group', { name: '기간' }).getByRole('button', { name: '30일' }),
  ).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('group', { name: '기간' }).getByRole('button', { name: '7일' }).click();
  await expect(page.getByTestId('range-games')).toContainText('7일 판 수');
  const people = page.getByTestId('chart-people');
  await people.getByText('표로 보기').click();
  await expect(people.locator('tbody tr')).toHaveCount(7);

  // 360px에서 가로 스크롤이 없다
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // 통계 화면에서 게임 목록으로
  await page.getByRole('button', { name: '게임 목록' }).click();
  await expect(page).toHaveURL(/\/$/);
});
