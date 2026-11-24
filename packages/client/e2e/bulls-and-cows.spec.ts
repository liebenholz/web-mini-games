import { expect, test, type Page } from '@playwright/test';

/** 숫자야구 방을 만들고 (빈자리 봇) 시작해서 비밀 숫자 단계까지. E2E 서버는 시간 배율 0.05 */
async function startVsBot(page: Page) {
  await page.addInitScript(() => localStorage.setItem('wmg.nickname', '야구테스터'));
  await page.goto('/bulls-and-cows');
  await page.getByRole('button', { name: '방 만들기' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
  await expect(page).toHaveURL(/\/bulls-and-cows\/r\/[A-HJ-NP-Z2-9]{6}$/);
  await expect(page.getByTestId('fixed-rules')).toContainText('3자리 1S 2B · OUT / 4자리 1B 2C · 0B 0C');
  // 시간 배율 때문에 비밀 숫자 60초가 3초로 줄어서, 턴을 길게 해 두면 입력할 여유가 생긴다
  const turn = page.getByRole('group', { name: '턴 제한(초) · 넘기면 그 턴을 넘겨요' });
  await turn.getByRole('button', { name: '60' }).click();
  await expect(turn.getByRole('button', { name: '60' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '게임 시작' }).click();
  await expect(page.getByTestId('secret-slots')).toBeVisible({ timeout: 15_000 });
}

test('Phase 2 M4: 메인에서 숫자야구를 골라 로비로 가고 규칙을 볼 수 있다', async ({ page }) => {
  await page.goto('/');
  const card = page.getByTestId('game-bulls-and-cows');
  await expect(card).toContainText('스트라이크와 볼로 상대 숫자를 맞혀요');
  await card.getByRole('button', { name: '숫자야구 규칙 보기' }).click();
  const sheet = page.getByRole('dialog', { name: '숫자야구 규칙' });
  await expect(sheet).toContainText('결과 읽는 법');
  await expect(sheet).toContainText('OUT');
  await expect(sheet).toContainText('0B 0C');
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: '숫자야구 하러 가기' }).click();
  await expect(page).toHaveURL(/\/bulls-and-cows$/);
  await expect(page.getByRole('heading', { name: '숫자야구' })).toBeVisible();
});

test('B-01: 비밀 숫자는 고른 숫자를 다시 못 누르고, 정하면 내 화면에만 보인다', async ({ page }) => {
  await startVsBot(page);
  const keys = page.getByTestId('secret-slots').locator('..');
  await keys.locator('[data-key="1"]').click();
  await expect(keys.locator('[data-key="1"]')).toBeDisabled();
  await keys.locator('[data-key="0"]').click();
  await keys.locator('[data-key="2"]').click();
  await page.getByTestId('set-secret').click();
  await expect(page.getByTestId('my-secret')).toContainText('102');
});

test('M4: 사람 1명 + 봇으로 한 판을 끝까지 하고, 끝나면 두 비밀 숫자를 공개한다', async ({ page }) => {
  await startVsBot(page);
  await page.getByTestId('random-secret').click();
  const result = page.getByTestId('result');
  const candidates = ['012', '345', '678', '901', '234', '567', '890', '123', '456', '789'];
  for (let i = 0; i < 200; i += 1) {
    if (
      await result
        .getByTestId('reveal')
        .isVisible()
        .catch(() => false)
    )
      break;
    const go = page.getByTestId('guess');
    if (await go.isVisible().catch(() => false)) {
      const enabledKey = page.locator('.bc-keys.six [data-key="0"]');
      if (await enabledKey.isEnabled().catch(() => false)) {
        await page.keyboard.type(candidates[i % candidates.length] as string);
        await page.keyboard.press('Enter');
      }
    }
    await page.waitForTimeout(150);
  }
  const reveal = result.getByTestId('reveal');
  await expect(reveal).toBeVisible({ timeout: 60_000 });
  const numbers = await reveal.locator('span').allTextContents();
  expect(numbers).toHaveLength(2);
  for (const n of numbers) expect(n).toMatch(/^\d{3}$/);
  await expect(result).toContainText('다시 하기');
});

test('메모판: 누를 때마다 ? → 없음 → 있음 → ?', async ({ page }) => {
  await startVsBot(page);
  await page.getByTestId('random-secret').click();
  const mark = page.getByTestId('memo').locator('[data-memo="3"]');
  await expect(mark).toBeVisible({ timeout: 15_000 });
  await expect(mark).toHaveAttribute('aria-label', '3 모름');
  await mark.click();
  await expect(mark).toHaveAttribute('aria-label', '3 없음');
  await mark.click();
  await expect(mark).toHaveAttribute('aria-label', '3 있음');
  await mark.click();
  await expect(mark).toHaveAttribute('aria-label', '3 모름');
});

test('360px: 추측 키패드와 메모판이 모두 화면 안에 있다', async ({ page }) => {
  await startVsBot(page);
  await page.getByTestId('random-secret').click();
  await expect(page.getByTestId('memo')).toBeVisible({ timeout: 15_000 });
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.bc-keys button, .bc-memo button, [data-testid=guess]')].map(
      (el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width };
      },
    ),
  );
  expect(boxes.length).toBeGreaterThanOrEqual(22);
  for (const b of boxes) {
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeLessThanOrEqual(360);
    expect(b.width).toBeGreaterThanOrEqual(28);
  }
});
