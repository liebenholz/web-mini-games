import { expect, test, type Page } from '@playwright/test';

const cards = (page: Page) => page.locator('.game-list .game-card');

test('칩으로 거르면 그 카테고리만 보이고 주소가 바뀐다. 다시 누르면 전체', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('hub-count')).toContainText('게임 10개');
  await expect(cards(page)).toHaveCount(10);
  await page.getByTestId('chip-party').click();
  await expect(cards(page)).toHaveCount(4);
  await expect(page.getByTestId('hub-count')).toContainText('4개 게임');
  await expect(page.getByTestId('chip-party')).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/\/\?c=party$/);
  await page.getByTestId('chip-party').click();
  await expect(cards(page)).toHaveCount(10);
  await expect(page).toHaveURL(/\/$/);
});

test('검색은 입력하는 대로 걸러지고 맞는 글자를 표시하며, 칩과 함께 쓴다', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('hub-search').fill('주사위');
  await expect(cards(page)).toHaveCount(2);
  await expect(page.locator('.game-card mark').first()).toHaveText('주사위');
  await expect(page).toHaveURL(/\?q=/);
  // 칩과 함께: 카드 카테고리 안에서만
  await page.getByTestId('chip-party').click();
  await expect(page.getByTestId('hub-empty')).toBeVisible();
  await expect(page.getByTestId('hub-empty')).toContainText('찾는 게임이 없어요');
  await page.getByTestId('hub-empty').getByRole('button', { name: '필터 지우기' }).click();
  await expect(cards(page)).toHaveCount(10);
  await expect(page.getByTestId('hub-search')).toHaveValue('');
});

test('주소의 필터로 열면 그대로 적용되고, 카드를 눌러 갔다가 뒤로 와도 유지된다', async ({ page }) => {
  await page.goto('/?q=%EB%B3%B4%EB%AC%BC');
  await expect(page.getByTestId('hub-search')).toHaveValue('보물');
  await expect(cards(page)).toHaveCount(1);
  await cards(page).first().getByRole('button', { name: '보물 찾기 하러 가기' }).click();
  await expect(page).toHaveURL(/\/treasure$/);
  await page.goBack();
  await expect(page.getByTestId('hub-search')).toHaveValue('보물');
  await expect(cards(page)).toHaveCount(1);
});

test('Esc와 ✕로 검색어를 지운다. 360px에서 가로로 넘치지 않고 칩과 검색창이 보인다', async ({ page }) => {
  await page.goto('/');
  const input = page.getByTestId('hub-search');
  await input.fill('오목');
  await expect(cards(page)).toHaveCount(1);
  await page.getByRole('button', { name: '검색어 지우기' }).click();
  await expect(cards(page)).toHaveCount(10);
  await input.fill('원카드');
  await input.press('Escape');
  await expect(input).toHaveValue('');
  await expect(cards(page)).toHaveCount(10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(input).toBeInViewport();
  await expect(page.getByTestId('chip-all')).toBeInViewport();
  // 스크롤해도 검색창과 칩은 맨 위에 붙어 있다
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(input).toBeInViewport();
});
