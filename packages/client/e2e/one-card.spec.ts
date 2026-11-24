import { expect, test, type Page } from '@playwright/test';

/** 원카드 방을 만들고 (빈자리 봇 3명) 시작한다. E2E 서버는 시간 배율 0.05라 턴이 짧다 */
async function startWithBots(page: Page) {
  await page.addInitScript(() => localStorage.setItem('wmg.one-card.nickname', '카드테스터'));
  await page.goto('/one-card');
  await page.getByRole('button', { name: '방 만들기' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
  await expect(page).toHaveURL(/\/one-card\/r\/[A-HJ-NP-Z2-9]{6}$/);
  await expect(page.getByTestId('fixed-rules')).toContainText('1장 남으면 원카드 (3초)');
  await page.getByRole('button', { name: '게임 시작' }).click();
  await expect(page.getByTestId('oc-hand')).toBeVisible();
  await expect(page.getByTestId('oc-hand').locator('.oc-hand-card').first()).toBeVisible({ timeout: 15_000 });
}

test('Phase 2 M3: 메인에서 원카드를 골라 로비로 가고 규칙을 볼 수 있다', async ({ page }) => {
  await page.goto('/');
  const card = page.getByTestId('game-one-card');
  await expect(card).not.toContainText('준비 중');
  await card.getByRole('button', { name: '원카드 규칙 보기' }).click();
  const sheet = page.getByRole('dialog', { name: '원카드 규칙' });
  await expect(sheet).toContainText('공격 카드로 떠넘겨요');
  await expect(sheet).toContainText('컬러 조커로만 받아쳐요');
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: '원카드 하러 가기' }).click();
  await expect(page).toHaveURL(/\/one-card$/);
  await expect(page.getByRole('heading', { name: '원카드' })).toBeVisible();
});

test('CT-16: 내 패만 앞면으로 보이고 상대 3명은 장수만 보인다', async ({ page }) => {
  await startWithBots(page);
  const opps = page.getByTestId('opponents').locator('[data-player]');
  await expect(opps).toHaveCount(3);
  await expect(opps.first()).toContainText('장');
  await expect(page.getByTestId('opponents').locator('[data-card]')).toHaveCount(0);
  await expect(page.getByTestId('top-card').locator('[data-card]')).toHaveCount(1);
});

test('M3: 사람 1명 + 봇 3명으로 한 판을 끝까지 하고 순위를 본다', async ({ page }) => {
  await startWithBots(page);
  const result = page.getByTestId('result');
  const hand = page.getByTestId('oc-hand');
  // 내 차례면 낼 수 있는 카드를 내거나 가져오고, 원카드 버튼이 뜨면 누른다. 못 하면 자동 진행(C-52)이 끝낸다
  for (let i = 0; i < 400; i += 1) {
    if (
      await result
        .locator('.oc-ranking')
        .isVisible()
        .catch(() => false)
    )
      break;
    const call = page.getByTestId('oc-one-card');
    if (await call.isVisible().catch(() => false)) await call.click({ timeout: 500 }).catch(() => undefined);
    const up = hand.locator('.oc-hand-card.up').first();
    if (await up.isVisible().catch(() => false)) {
      await up.click({ timeout: 500 }).catch(() => undefined);
      const suit = page.getByTestId('suit-S');
      if (await suit.isVisible().catch(() => false))
        await suit.click({ timeout: 500 }).catch(() => undefined);
    }
    await page.waitForTimeout(100);
  }
  await expect(result.locator('.oc-ranking li')).toHaveCount(4, { timeout: 120_000 });
  await expect(result).toContainText('다시 하기');
});

test('360px: 패가 많아도 카드마다 누를 수 있는 자리가 남는다', async ({ page }) => {
  await startWithBots(page);
  const hand = page.getByTestId('oc-hand');
  // 계속 가져오면 패가 늘어난다 (자동 진행이 되기 전까지)
  for (let i = 0; i < 60 && (await hand.locator('.oc-hand-card').count()) < 12; i += 1) {
    const draw = page.getByTestId('oc-draw');
    if (await draw.isEnabled().catch(() => false)) await draw.click({ timeout: 300 }).catch(() => undefined);
    const pass = page.getByTestId('oc-pass');
    if (await pass.isVisible().catch(() => false)) await pass.click({ timeout: 300 }).catch(() => undefined);
    await page.waitForTimeout(80);
  }
  // 봇이 계속 두어 패가 다시 그려질 수 있으므로, 위치 측정과 누르기 검사를 페이지 안에서 한 번에 한다
  const report = await page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>('[data-testid=oc-hand] .oc-hand-card')];
    return cards.map((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + 4, r.bottom - 12)?.closest<HTMLElement>('.oc-hand-card');
      return { card: el.dataset.card, left: r.left, right: r.right, hit: hit?.dataset.card ?? null };
    });
  });
  expect(report.length).toBeGreaterThanOrEqual(8);
  for (const c of report) {
    expect(c.left).toBeGreaterThanOrEqual(0);
    expect(c.right).toBeLessThanOrEqual(360);
    // 각 카드의 왼쪽 가장자리 근처를 누르면 그 카드가 잡힌다 (다음 카드에 완전히 가려지지 않음)
    expect(c.hit, c.card).toBe(c.card);
  }
});
