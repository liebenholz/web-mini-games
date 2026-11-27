import { expect, test, type Page } from '@playwright/test';

/** 업다운 방을 만들고 봇과 시작한다 (E2E 서버는 시간 배율 0.05: 턴 30초 → 1.5초) */
async function startVsBots(page: Page, maxPlayers = '3') {
  await page.addInitScript(() => localStorage.setItem('wmg.nickname', '업다운테스터'));
  await page.goto('/updown-bomb');
  await page.getByRole('button', { name: '방 만들기' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
  await expect(page).toHaveURL(/\/updown-bomb\/r\/[A-HJ-NP-Z2-9]{6}$/);
  const players = page.getByRole('group', { name: '최대 인원' });
  await players.getByRole('button', { name: maxPlayers, exact: true }).click();
  const turn = page.getByRole('group', { name: '턴 제한(초) · 넘기면 대신 말해요' });
  await turn.getByRole('button', { name: '30' }).click();
  await expect(turn.getByRole('button', { name: '30' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '게임 시작' }).click();
  await expect(page.getByTestId('ud-range')).toBeVisible({ timeout: 15_000 });
}

test('메인에서 업다운 숫자폭탄을 골라 로비로 간다 (파티 카테고리)', async ({ page }) => {
  await page.goto('/');
  const card = page.getByTestId('game-updown-bomb');
  await expect(card).toContainText('범위를 좁히다 폭탄 숫자를 말하면 당첨');
  await card.getByRole('button', { name: '업다운 숫자폭탄 규칙 보기' }).click();
  await expect(page.getByRole('dialog', { name: '업다운 숫자폭탄 규칙' })).toContainText(
    '폭탄을 말하면 당첨',
  );
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: '업다운 숫자폭탄 하러 가기' }).click();
  await expect(page).toHaveURL(/\/updown-bomb$/);
  await expect(page.getByRole('heading', { name: '업다운 숫자폭탄' })).toBeVisible();
});

test('대기실: 옵션 요약과 범위', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wmg.nickname', '방장'));
  await page.goto('/updown-bomb');
  await page.getByRole('button', { name: '방 만들기' }).click();
  const summary = page.getByTestId('options-summary');
  await expect(summary).toContainText('범위 1~100 · 최대 6명 · 턴 15초');
  await page.getByRole('group', { name: '숫자 범위' }).getByRole('button', { name: '1~50' }).click();
  await expect(summary).toContainText('범위 1~50');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('UT-09: 360px에서 키패드로 말하고, 범위 밖은 막히며, 끝나면 당첨·통과와 폭탄 숫자가 나온다', async ({
  page,
}) => {
  await startVsBots(page);
  // 내 차례가 올 때까지 (봇은 1~2초 × 0.05)
  const call = page.getByTestId('ud-call');
  await expect(call).toBeVisible({ timeout: 20_000 });
  await expect(call).toBeInViewport();
  const [low] = (await page.getByTestId('ud-range').innerText()).split('~').map((s) => parseInt(s, 10));
  // 범위 밖(0)은 말하기가 꺼진다
  if ((low ?? 1) > 0) {
    await page.locator('[data-key="0"]').click();
    if ((await page.getByTestId('ud-call').count()) > 0)
      await expect(page.getByTestId('ud-call')).toBeDisabled();
  }
  const log = page.getByTestId('ud-log');
  const before = (await log.count()) > 0 ? await log.locator('li').count() : 0;
  if ((await page.getByTestId('ud-call').count()) > 0) {
    await page.getByRole('button', { name: '지우기' }).click();
    for (const d of String(low)) await page.locator(`[data-key="${d}"]`).click();
    await page.getByTestId('ud-call').click();
    await expect
      .poll(async () => ((await log.count()) > 0 ? log.locator('li').count() : 0))
      .toBeGreaterThan(before);
  }

  // 그 뒤로는 말하지 않는다: 시간 초과로 대신 말하다 봇이 이어서 해 판이 끝난다 (UD-12)
  const result = page.getByTestId('result');
  await expect(result).toBeVisible({ timeout: 120_000 });
  await expect(result).toContainText(/당첨!|통과!/);
  // 폭탄 숫자가 공개된다 (UD-22)
  await expect(result).toContainText(/\d+/);
  await expect(page.locator('.ud-sum')).toContainText(/\d+번 만에 · 범위 1~100/);

  await page.getByRole('button', { name: '다시 하기' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
});

test('PC: 숫자키와 Enter로 말한다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await startVsBots(page, '2');
  await expect(page.getByTestId('ud-call')).toBeVisible({ timeout: 20_000 });
  const [low] = (await page.getByTestId('ud-range').innerText()).split('~').map((s) => parseInt(s, 10));
  await page.keyboard.type(String(low));
  await expect(page.getByTestId('ud-entry')).toHaveText(String(low));
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('ud-log').locator('li').first()).toContainText(String(low));
});
