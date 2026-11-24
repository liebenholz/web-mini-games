import { expect, test, type Page } from '@playwright/test';

/** 판 교차점(x 0~14 = A~O, y 0~14 = 1~15행)의 화면 좌표. viewBox 160, 가장자리 10, 칸 10 */
async function point(page: Page, x: number, y: number) {
  const box = await page.getByTestId('gomoku-board').boundingBox();
  if (!box) throw new Error('no board');
  return {
    x: box.x + (box.width * (10 + 10 * x)) / 160,
    y: box.y + (box.height * (10 + 10 * (14 - y))) / 160,
  };
}

async function stones(page: Page): Promise<number> {
  return page.locator('[data-testid=gomoku-board] .stone').count();
}

/** 오목 방을 만들고 방장이 흑으로 봇과 대국을 시작한다 */
async function startVsBot(page: Page, turnSeconds?: '15' | '30' | '60') {
  await page.addInitScript(() => localStorage.setItem('wmg.nickname', '오목테스터'));
  await page.goto('/gomoku');
  await page.getByRole('button', { name: '방 만들기' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
  await expect(page).toHaveURL(/\/gomoku\/r\/[A-HJ-NP-Z2-9]{6}$/);
  const black = page.getByRole('group', { name: '흑(선)은 누가' });
  await black.getByRole('button', { name: '방장' }).click();
  await expect(black.getByRole('button', { name: '방장' })).toHaveAttribute('aria-pressed', 'true');
  if (turnSeconds) {
    const turn = page.getByRole('group', { name: '턴 제한(초) · 넘기면 시간패' });
    await turn.getByRole('button', { name: turnSeconds }).click();
    await expect(turn.getByRole('button', { name: turnSeconds })).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: '게임 시작' }).click();
  await expect(page.getByTestId('gomoku-board')).toBeVisible();
  await expect(page.locator('.player-card[data-color=black]')).toContainText('내 차례', { timeout: 15_000 });
}

test('Phase 2 M2: 메인에서 오목을 골라 로비로 간다', async ({ page }) => {
  await page.goto('/');
  const card = page.getByTestId('game-gomoku');
  await expect(card).toContainText('다섯 개를 먼저 잇는 사람이 이겨요');
  await card.getByRole('button', { name: '오목 규칙 보기' }).click();
  await expect(page.getByRole('dialog', { name: '오목 규칙' })).toContainText('흑에게만 금수가 있어요');
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: '오목 하러 가기' }).click();
  await expect(page).toHaveURL(/\/gomoku$/);
  await expect(page.getByRole('heading', { name: '오목' })).toBeVisible();
});

test('대기실: 옵션 요약을 누르면 방 옵션으로 내려가고, 기본 금수는 모두 켜져 있다', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.addInitScript(() => localStorage.setItem('wmg.nickname', '방장'));
  await page.goto('/gomoku');
  await page.getByRole('button', { name: '방 만들기' }).click();
  const summary = page.getByTestId('options-summary');
  await expect(summary).toContainText('흑(선): 무작위 · 금수 3-3·4-4·장목 · 턴 30초');
  await summary.click();
  await expect(page.locator('#gomoku-options')).toBeInViewport();
  for (const name of ['3-3 금지', '4-4 금지', '장목(6목 이상) 금지'])
    await expect(page.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('switch', { name: '4-4 금지' }).click();
  await expect(summary).toContainText('금수 3-3·장목');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('G-30: 마우스는 올리면 반투명 돌, 클릭하면 바로 착수하고 봇이 응수한다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await startVsBot(page);
  const h8 = await point(page, 7, 7);
  await page.mouse.move(h8.x, h8.y);
  await expect(page.getByTestId('ghost')).toHaveCount(1);
  await expect(page.getByTestId('touch-confirm')).toBeHidden();
  await page.mouse.click(h8.x, h8.y);
  await expect.poll(() => stones(page)).toBeGreaterThanOrEqual(1);
  // 봇(백)이 둔다
  await expect.poll(() => stones(page), { timeout: 10_000 }).toBe(2);
  await expect(page.locator('.gomoku-moves')).toHaveText('2수');
});

test('G-31: 터치는 첫 터치에 미리보기, 같은 자리를 다시 누르면 착수', async ({ page }) => {
  await startVsBot(page);
  const h8 = await point(page, 7, 7);
  await page.touchscreen.tap(h8.x, h8.y);
  const confirm = page.getByTestId('touch-confirm');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('H8에 둘까요?');
  expect(await stones(page)).toBe(0);
  // 다른 자리를 누르면 미리보기가 옮겨 간다
  const i7 = await point(page, 8, 6);
  await page.touchscreen.tap(i7.x, i7.y);
  await expect(confirm).toContainText('I7에 둘까요?');
  await page.touchscreen.tap(i7.x, i7.y);
  await expect(confirm).toBeHidden();
  await expect.poll(() => stones(page)).toBeGreaterThanOrEqual(1);
  // "여기에 두기" 버튼으로도 둔다
  await expect.poll(() => stones(page), { timeout: 10_000 }).toBe(2);
  await expect(page.locator('.player-card[data-color=black]')).toContainText('내 차례');
  const a1 = await point(page, 0, 0);
  await page.touchscreen.tap(a1.x, a1.y);
  await page.getByTestId('place-confirm').click();
  await expect.poll(() => stones(page)).toBeGreaterThanOrEqual(3);
});

test('G-12: 시간 안에 두지 않으면 시간패, 다시 하기로 대기실로 돌아온다', async ({ page }) => {
  await startVsBot(page, '15');
  const result = page.getByTestId('result');
  await expect(result).toContainText('졌어요', { timeout: 30_000 });
  await expect(result).toContainText('시간패');
  await result.getByRole('button', { name: '다시 하기' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
});
