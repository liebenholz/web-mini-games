import { expect, test, type Page } from '@playwright/test';

const board = (page: Page) => page.getByTestId('reversi-board');
const stones = (page: Page) => page.locator('[data-testid=reversi-board] .stone').count();
const dots = (page: Page) => page.locator('[data-testid=reversi-board] [data-legal]');

/** 리버시 방을 만들고 방장이 흑으로 봇과 대국을 시작한다 (E2E 서버는 시간 배율 0.05) */
async function startVsBot(page: Page, turnSeconds: '15' | '30' | '60' = '60') {
  await page.addInitScript(() => localStorage.setItem('wmg.nickname', '리버시테스터'));
  await page.goto('/reversi');
  await page.getByRole('button', { name: '방 만들기' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
  await expect(page).toHaveURL(/\/reversi\/r\/[A-HJ-NP-Z2-9]{6}$/);
  const black = page.getByRole('group', { name: '흑(선)은 누가' });
  await black.getByRole('button', { name: '방장' }).click();
  await expect(black.getByRole('button', { name: '방장' })).toHaveAttribute('aria-pressed', 'true');
  const turn = page.getByRole('group', { name: '턴 제한(초) · 넘기면 대신 둬요' });
  await turn.getByRole('button', { name: turnSeconds }).click();
  await expect(turn.getByRole('button', { name: turnSeconds })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '게임 시작' }).click();
  await expect(board(page)).toBeVisible();
  await expect(page.locator('.player-card[data-color=black]')).toContainText('내 차례', { timeout: 15_000 });
}

async function center(page: Page, nth = 0) {
  const box = await dots(page).nth(nth).boundingBox();
  if (!box) throw new Error('no legal dot');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('메인에서 리버시를 골라 로비로 간다', async ({ page }) => {
  await page.goto('/');
  const card = page.getByTestId('game-reversi');
  await expect(card).toContainText('끼워서 뒤집고, 돌이 많은 쪽이 이겨요');
  await card.getByRole('button', { name: '리버시 규칙 보기' }).click();
  await expect(page.getByRole('dialog', { name: '리버시 규칙' })).toContainText('끼우면 뒤집혀요');
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: '리버시 하러 가기' }).click();
  await expect(page).toHaveURL(/\/reversi$/);
  await expect(page.getByRole('heading', { name: '리버시' })).toBeVisible();
});

test('대기실: 옵션 요약과 턴 시간', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wmg.nickname', '방장'));
  await page.goto('/reversi');
  await page.getByRole('button', { name: '방 만들기' }).click();
  const summary = page.getByTestId('options-summary');
  await expect(summary).toContainText('흑(선): 무작위 · 턴 30초');
  await page
    .getByRole('group', { name: '턴 제한(초) · 넘기면 대신 둬요' })
    .getByRole('button', { name: '15' })
    .click();
  await expect(summary).toContainText('턴 15초');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('RT-08: 360px에서 판이 다 보이고, 점을 한 번 누르면 두며, 끝까지 가면 돌 수로 결과가 나온다', async ({
  page,
}) => {
  await startVsBot(page);
  // 판 전체가 화면 안
  await expect(board(page)).toBeInViewport({ ratio: 1 });
  // RT-01: 흑의 첫 합법 수 4곳이 점으로 보인다
  await expect(dots(page)).toHaveCount(4);
  expect(await stones(page)).toBe(4);
  const p = await center(page);
  await page.touchscreen.tap(p.x, p.y);
  // 한 번에 둔다 (확인 상자 없음). 봇 응수가 빨라(시간 배율 0.05) 정확한 돌 수 대신 수와 돌 개수로 본다
  await expect(page.locator('.gomoku-moves')).not.toHaveText('0수');
  await expect.poll(() => stones(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(6);

  // 그 뒤로는 두지 않는다: 시간 초과로 대신 두다가 2번 연속이면 봇이 이어서 둔다 (RV-12)
  await expect(page.locator('.gomoku-notice')).toContainText('대신', { timeout: 20_000 });
  const result = page.getByTestId('result');
  await expect(result).toBeVisible({ timeout: 120_000 });
  await expect(result).toContainText(/이겼어요|졌어요|무승부/);
  const black = Number(await page.getByTestId('count-black').textContent());
  const white = Number(await page.getByTestId('count-white').textContent());
  await expect(result.locator('.rv-score')).toContainText(`${black}`);
  await expect(result.locator('.rv-score')).toContainText(`${white}`);
  expect(black + white).toBeLessThanOrEqual(64);
  await expect(result).toContainText(/\d+수 · 넘김 \d+번/);

  await result.getByRole('button', { name: '다시 하기' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
});

test('PC: 마우스를 올리면 뒤집힐 돌을 미리 보여 주고, 클릭하면 둔다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await startVsBot(page);
  const p = await center(page);
  await page.mouse.move(p.x, p.y);
  await expect(page.locator('[data-testid=reversi-board] .ghost')).toHaveCount(1);
  await expect(page.locator('[data-testid=reversi-board] .will-flip')).toHaveCount(1);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.gomoku-moves')).not.toHaveText('0수');
  await expect.poll(() => stones(page)).toBeGreaterThanOrEqual(5);
});
