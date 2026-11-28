import { expect, test, type Page } from '@playwright/test';

/** 보물 찾기 방을 만들고 봇과 시작한다 (E2E 서버는 시간 배율 0.05). 선택 시간은 30초(=1.5초) */
async function startVsBots(page: Page, maxPlayers = '3') {
  await page.addInitScript(() => localStorage.setItem('wmg.nickname', '보물테스터'));
  await page.goto('/treasure');
  await page.getByRole('button', { name: '방 만들기' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
  await expect(page).toHaveURL(/\/treasure\/r\/[A-HJ-NP-Z2-9]{6}$/);
  await page
    .getByRole('group', { name: '최대 인원' })
    .getByRole('button', { name: maxPlayers, exact: true })
    .click();
  const time = page.getByRole('group', { name: '선택 시간(초) · 넘기면 대신 골라요' });
  await time.getByRole('button', { name: '30' }).click();
  await expect(time.getByRole('button', { name: '30' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '게임 시작' }).click();
  await expect(page.getByTestId('th-status')).toBeVisible({ timeout: 15_000 });
}

test('메인에서 보물 찾기를 골라 로비로 간다 (파티 카테고리, 2~10명)', async ({ page }) => {
  await page.goto('/');
  const card = page.getByTestId('game-treasure');
  await expect(card).toContainText('보물에서 가장 멀리 고르면 당첨');
  await expect(card).toContainText('2~10명');
  await card.getByRole('button', { name: '보물 찾기 규칙 보기' }).click();
  await expect(page.getByRole('dialog', { name: '보물 찾기 규칙' })).toContainText(
    '보물에서 가장 먼 사람이 당첨',
  );
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: '보물 찾기 하러 가기' }).click();
  await expect(page).toHaveURL(/\/treasure$/);
});

test('대기실: 옵션 요약, 인원 2~10 선택이 360px를 넘치지 않는다', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wmg.nickname', '방장'));
  await page.goto('/treasure');
  await page.getByRole('button', { name: '방 만들기' }).click();
  const summary = page.getByTestId('options-summary');
  await expect(summary).toContainText('최대 6명 · 선택 15초');
  const players = page.getByRole('group', { name: '최대 인원' });
  await players.getByRole('button', { name: '10', exact: true }).click();
  await expect(summary).toContainText('최대 10명');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('HT-09: 360px에서 9×9 판 전체와 확정 버튼이 보이고, 고른 칸을 확정하면 끝까지 가서 당첨/통과가 나온다', async ({
  page,
}) => {
  await startVsBots(page);
  const confirm = page.getByTestId('th-confirm');
  await expect(confirm).toBeVisible();
  // 판 81칸이 모두 첫 화면 안
  await expect(page.locator('.th-grid .th-cell')).toHaveCount(81);
  await expect(page.locator('[data-cell="8,8"]')).toBeInViewport({ ratio: 1 });
  await expect(confirm).toBeInViewport({ ratio: 1 });
  await expect(confirm).toBeDisabled();
  await page.locator('[data-cell="2,5"]').click();
  await expect(confirm).toContainText('C6로 확정');
  // 다른 칸으로 바꿀 수 있다
  await page.locator('[data-cell="6,1"]').click();
  await expect(confirm).toContainText('G2로 확정');
  await confirm.click();
  // E2E의 봇은 빨라서 "기다리는 중"이 거의 안 보이고 바로 공개될 수 있다. 확정되었거나 이미 공개됐으면 된다
  await expect(page.getByTestId('th-locked').or(page.getByTestId('th-rank'))).toBeVisible();
  // 재대결이 나와도 끝까지: 나중에는 고르지 않고 시간 초과·봇에 맡긴다
  const result = page.getByTestId('result');
  await expect(result).toBeVisible({ timeout: 120_000 });
  await expect(result).toContainText(/당첨!|통과!|님 당첨/);
  await expect(page.getByTestId('th-rank').locator('.row').first()).toContainText(/\d+\.\d칸/);
  await page.getByRole('button', { name: '다시 하기' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
});

test('10명: 칩이 5칸×2줄이고 판과 확정 버튼이 첫 화면 안에 있다', async ({ page }) => {
  await startVsBots(page, '10');
  await expect(page.locator('.ud-players.ten .ud-p')).toHaveCount(10);
  const confirm = page.getByTestId('th-confirm');
  if ((await confirm.count()) > 0) {
    await expect(page.locator('[data-cell="8,8"]')).toBeInViewport({ ratio: 1 });
    await expect(confirm).toBeInViewport({ ratio: 1 });
  }
});

test('PC: 방향키와 Enter로 칸을 고르고 Space로 확정한다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await startVsBots(page);
  await expect(page.getByTestId('th-confirm')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('th-confirm')).toContainText('로 확정');
  await page.keyboard.press('Space');
  // E2E의 봇은 빨라서 "기다리는 중"이 거의 안 보이고 바로 공개될 수 있다. 확정되었거나 이미 공개됐으면 된다
  await expect(page.getByTestId('th-locked').or(page.getByTestId('th-rank'))).toBeVisible();
});
