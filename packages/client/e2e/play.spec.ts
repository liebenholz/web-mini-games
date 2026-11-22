import { expect, test, type Page } from '@playwright/test';

async function setNickname(page: Page, name: string) {
  await page.locator('#nickname').fill(name);
}

async function expectAllButtonsOnScreen(page: Page) {
  const width = page.viewportSize()!.width;
  for (const button of await page.locator('button:visible').all()) {
    const box = await button.boundingBox();
    if (!box) continue;
    expect(box.x, await button.innerText()).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
    expect(box.height).toBeGreaterThanOrEqual(40); // 터치 가능한 높이
  }
}

test('M4: 사람 1명 + 봇 2명으로 한 판 완주 (360px)', async ({ page }) => {
  await page.goto('/');
  await expectAllButtonsOnScreen(page);
  await setNickname(page, '테스터');
  await page.getByRole('button', { name: '방 만들기' }).click();

  const code = page.getByTestId('room-code');
  await expect(code).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
  await expect(page).toHaveURL(new RegExp(`/r/${await code.innerText()}$`));

  // 방 옵션: 최대 3명(빈자리 봇 2명), 시작 주사위 3개
  await page.getByRole('group', { name: '최대 인원' }).getByRole('button', { name: '3' }).click();
  await expect(
    page.getByRole('group', { name: '최대 인원' }).getByRole('button', { name: '3' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('group', { name: '시작 주사위' }).getByRole('button', { name: '3' }).click();
  await expect(
    page.getByRole('group', { name: '시작 주사위' }).getByRole('button', { name: '3' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expectAllButtonsOnScreen(page);
  await page.getByRole('button', { name: '시작' }).click();

  // 게임 화면: 내 차례가 오면 직접 선언한다
  await expect(page.locator('canvas')).toBeVisible();
  const bid = page.getByTestId('bid');
  await expect(bid).toBeEnabled({ timeout: 30_000 });
  await expectAllButtonsOnScreen(page);
  await bid.click();
  await expect(page.locator('.statusbar .total')).toContainText('9');

  // 이후에는 무입력: 2턴 타임아웃 뒤 자동 진행 (S-07) → 게임 종료
  const result = page.getByTestId('result');
  await expect(result).toBeVisible({ timeout: 150_000 });
  await expect(result.locator('.ranking li')).toHaveCount(3);
  await expectAllButtonsOnScreen(page);

  // 리매치하면 같은 방 대기실로 돌아간다
  await result.getByRole('button', { name: '다시 하기' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
});

test('M4: 초대 링크 /r/:code로 바로 대기실에 들어간다', async ({ page, browser }) => {
  await page.goto('/');
  await setNickname(page, '방장');
  await page.getByRole('button', { name: '방 만들기' }).click();
  const code = await page.getByTestId('room-code').innerText();

  const friend = await browser.newContext({ viewport: { width: 360, height: 740 } });
  await friend.addInitScript(() => localStorage.setItem('wmg.nickname', '친구'));
  const friendPage = await friend.newPage();
  await friendPage.goto(`/r/${code}`);
  await expect(friendPage.getByTestId('room-code')).toHaveText(code);
  await expect(page.locator('.seat .name', { hasText: '친구' })).toBeVisible();
  await friend.close();
});

for (const viewport of [
  { width: 360, height: 640 },
  { width: 1280, height: 720 },
]) {
  test(`대기실: 글자가 잘리거나 하단 바에 가려지지 않는다 (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await setNickname(page, '열두글자닉네임테스트용');
    await page.getByRole('button', { name: '방 만들기' }).click();
    await expect(page.getByTestId('room-code')).toBeVisible();
    await page.getByRole('button', { name: '봇 추가' }).click();
    await expect(page.locator('.seat .name')).toHaveCount(2);

    // 가로 스크롤 없음
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // 닉네임·배지·옵션 라벨이 상자 안에 다 들어간다 (말줄임·잘림 없음)
    const clipped = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '.seat .name, .badge, .option .label, .segmented button, .room-code .code',
        ),
      ]
        .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
        .map((el) => el.textContent),
    );
    expect(clipped).toEqual([]);
    // 끝까지 내리면 마지막 옵션이 하단 바 위에 보인다
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const lastOption = await page.locator('.option').last().boundingBox();
    const dock = await page.locator('.dock').boundingBox();
    expect(lastOption!.y + lastOption!.height).toBeLessThanOrEqual(dock!.y);
  });
}
