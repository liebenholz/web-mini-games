import { expect, test, type Page } from '@playwright/test';

/** 풍선 방을 만들고 봇 1명과 시작한다 (E2E 서버는 시간 배율 0.05). 2명이면 첫 차례가 봇이어도 곧 내 차례가 온다 */
async function startVsBot(page: Page) {
  await page.addInitScript(() => localStorage.setItem('wmg.nickname', '풍선테스터'));
  await page.goto('/balloon');
  await page.getByRole('button', { name: '방 만들기' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
  await expect(page).toHaveURL(/\/balloon\/r\/[A-HJ-NP-Z2-9]{6}$/);
  await page
    .getByRole('group', { name: '최대 인원' })
    .getByRole('button', { name: '2', exact: true })
    .click();
  const turn = page.getByRole('group', { name: '턴 제한(초) · 넘기면 대신 불어요' });
  await turn.getByRole('button', { name: '30' }).click();
  await expect(turn.getByRole('button', { name: '30' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '게임 시작' }).click();
  await expect(page.getByTestId('bl-total')).toBeVisible({ timeout: 15_000 });
}

test('메인에서 풍선 터뜨리기를 골라 로비로 간다 (파티 카테고리, 2~10명)', async ({ page }) => {
  await page.goto('/');
  const card = page.getByTestId('game-balloon');
  await expect(card).toContainText('바람을 불다 풍선이 터지면 당첨');
  await expect(card).toContainText('2~10명');
  await card.getByRole('button', { name: '풍선 터뜨리기 규칙 보기' }).click();
  await expect(page.getByRole('dialog', { name: '풍선 터뜨리기 규칙' })).toContainText('터뜨린 사람이 당첨');
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: '풍선 터뜨리기 하러 가기' }).click();
  await expect(page).toHaveURL(/\/balloon$/);
});

test('대기실: 옵션 요약, 인원 2~10 선택이 360px를 넘치지 않는다', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wmg.nickname', '방장'));
  await page.goto('/balloon');
  await page.getByRole('button', { name: '방 만들기' }).click();
  const summary = page.getByTestId('options-summary');
  await expect(summary).toContainText('최대 6명 · 턴 15초');
  const players = page.getByRole('group', { name: '최대 인원' });
  await players.getByRole('button', { name: '10', exact: true }).click();
  await expect(summary).toContainText('최대 10명');
  await expect(players.getByRole('button', { name: '10', exact: true })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('BT-07: 360px에서 바람 넣기·넘기기를 누르고, 끝까지 가면 당첨/통과와 터지는 횟수가 나온다', async ({
  page,
}) => {
  await startVsBot(page);
  const pump = page.getByTestId('bl-pump');
  await expect(pump).toBeVisible({ timeout: 30_000 });
  await expect(pump).toBeInViewport({ ratio: 1 });
  // 터지는 횟수는 이 화면 어디에도 숫자로 나오지 않는다 (범위만)
  await expect(page.locator('.bl-stage .lab')).toContainText(/5~\d+번 사이에서 터져요/);
  const before = Number(
    await page
      .getByTestId('bl-total')
      .innerText()
      .then((t) => t.match(/\d+/)?.[0] ?? '0'),
  );
  await pump.click();
  await expect
    .poll(async () => Number((await page.getByTestId('bl-total').innerText()).match(/\d+/)?.[0] ?? '0'))
    .toBeGreaterThan(before);
  if ((await page.getByTestId('bl-end').count()) > 0 && (await page.getByTestId('bl-end').isEnabled()))
    await page.getByTestId('bl-end').click();

  // 그 뒤로는 누르지 않는다: 시간 초과로 대신 불다가 봇이 이어서 해 판이 끝난다 (BL-12)
  const result = page.getByTestId('result');
  await expect(result).toBeVisible({ timeout: 120_000 });
  await expect(result).toContainText(/당첨!|통과!/);
  await expect(result).toContainText(/\d+번/);
  await expect(page.locator('.ud-sum')).toContainText(/\d+차례 · 전체 \d+번/);
  await page.getByRole('button', { name: '다시 하기' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
});

test('PC: Space로 바람을 넣는다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await startVsBot(page);
  await expect(page.getByTestId('bl-pump')).toBeVisible({ timeout: 30_000 });
  const before = Number((await page.getByTestId('bl-total').innerText()).match(/\d+/)?.[0] ?? '0');
  await page.keyboard.press('Space');
  await expect
    .poll(async () =>
      Number(
        (
          await page
            .getByTestId('bl-total')
            .innerText()
            .catch(() => '0')
        ).match(/\d+/)?.[0] ?? '0',
      ),
    )
    .toBeGreaterThan(before);
});
