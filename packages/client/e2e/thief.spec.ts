import { expect, test, type Page } from '@playwright/test';

/** 도둑잡기 방을 만들고 봇과 시작한다 (E2E 서버는 시간 배율 0.05). 턴 30초 = 1.5초 */
async function startVsBots(page: Page, maxPlayers = '4') {
  await page.addInitScript(() => localStorage.setItem('wmg.nickname', '도둑테스터'));
  await page.goto('/thief');
  await page.getByRole('button', { name: '방 만들기' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
  await expect(page).toHaveURL(/\/thief\/r\/[A-HJ-NP-Z2-9]{6}$/);
  await page
    .getByRole('group', { name: '최대 인원' })
    .getByRole('button', { name: maxPlayers, exact: true })
    .click();
  const time = page.getByRole('group', { name: '턴 제한(초) · 넘기면 대신 뽑아요' });
  await time.getByRole('button', { name: '30' }).click();
  await expect(time.getByRole('button', { name: '30' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '게임 시작' }).click();
  await expect(page.locator('.tf-hand-wrap')).toBeVisible({ timeout: 15_000 });
}

test('메인에서 도둑잡기를 골라 로비로 간다 (파티 카테고리, 2~6명)', async ({ page }) => {
  await page.goto('/');
  const card = page.getByTestId('game-thief');
  await expect(card).toContainText('조커를 마지막까지 들고 있으면 당첨');
  await expect(card).toContainText('2~6명');
  await card.getByRole('button', { name: '도둑잡기 규칙 보기' }).click();
  await expect(page.getByRole('dialog', { name: '도둑잡기 규칙' })).toContainText(
    '조커를 끝까지 든 사람이 당첨',
  );
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: '도둑잡기 하러 가기' }).click();
  await expect(page).toHaveURL(/\/thief$/);
});

test('대기실: 옵션 요약과 인원 2~6 선택', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('wmg.nickname', '방장'));
  await page.goto('/thief');
  await page.getByRole('button', { name: '방 만들기' }).click();
  const summary = page.getByTestId('options-summary');
  await expect(summary).toContainText('최대 4명 · 턴 15초');
  await page
    .getByRole('group', { name: '최대 인원' })
    .getByRole('button', { name: '6', exact: true })
    .click();
  await expect(summary).toContainText('최대 6명');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('TA-11: 360px에서 6명 칩과 내 패, 뽑기 버튼이 넘치지 않고 끝까지 가서 당첨/통과가 나온다', async ({
  page,
}) => {
  await startVsBots(page, '6');
  await expect(page.locator('.yt-players .yt-p')).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const result = page.getByTestId('result');
  let drew = 0;
  const fastClick = (loc: ReturnType<Page['locator']>) =>
    loc.click({ timeout: 700 }).then(
      () => true,
      () => false,
    );
  for (let i = 0; i < 800 && !(await result.isVisible()); i += 1) {
    const btn = page.getByTestId('tf-draw');
    if (drew < 3 && (await btn.count()) > 0 && (await fastClick(page.getByTestId('tf-back-0')))) {
      if (await fastClick(btn)) drew += 1;
    }
    await page.waitForTimeout(100);
  }
  await expect(result).toBeVisible({ timeout: 120_000 });
  await expect(result).toContainText(/당첨!|통과!|님 당첨/);
  // 끝나면 조커를 든 사람 한 명이 표시된다
  await expect(page.locator('.tf-final .row.lose')).toHaveCount(1);
  await expect(page.locator('.tf-final .row.lose [data-card="JK"]')).toHaveCount(1);
  await page.getByRole('button', { name: '다시 하기' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
});

test('PC: ←→로 카드를 고르고 Enter로 뽑는다', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await startVsBots(page, '3');
  // 내 차례가 올 때까지 기다린다 (봇이 먼저일 수 있다)
  const draw = page.getByTestId('tf-draw');
  await expect(draw).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('ArrowRight');
  await expect(draw).toContainText('번 카드 뽑기');
  await page.keyboard.press('Enter');
  await expect(draw).toBeHidden({ timeout: 5_000 });
});
