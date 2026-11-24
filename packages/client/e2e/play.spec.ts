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

test('M4·Phase 2 M1: 메인에서 게임을 골라 사람 1명 + 봇 2명으로 한 판 완주 (360px)', async ({ page }) => {
  await page.goto('/');
  await expectAllButtonsOnScreen(page);
  await page.getByRole('button', { name: '거짓말쟁이 주사위 하러 가기' }).click();
  await expect(page).toHaveURL(/\/liars-dice$/);
  await expectAllButtonsOnScreen(page);
  await setNickname(page, '테스터');
  await page.getByRole('button', { name: '방 만들기' }).click();

  const code = page.getByTestId('room-code');
  await expect(code).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
  await expect(page).toHaveURL(new RegExp(`/liars-dice/r/${await code.innerText()}$`));

  // 방 옵션: 최대 3명(빈자리 봇 2명), 시작 주사위 3개
  await page.getByRole('group', { name: '최대 인원' }).getByRole('button', { name: '3' }).click();
  await expect(
    page.getByRole('group', { name: '최대 인원' }).getByRole('button', { name: '3' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('group', { name: '시작 주사위' }).getByRole('button', { name: '3' }).click();
  await expect(
    page.getByRole('group', { name: '시작 주사위' }).getByRole('button', { name: '3' }),
  ).toHaveAttribute('aria-pressed', 'true');
  // E2E 시간 배율(0.05)에서 30초 턴은 1.5초뿐이라 느린 CI에서는 내 차례를 놓친다. 가장 긴 60초(3초)로 둔다
  await page.getByRole('group', { name: '턴 제한(초)' }).getByRole('button', { name: '60' }).click();
  await expect(
    page.getByRole('group', { name: '턴 제한(초)' }).getByRole('button', { name: '60' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expectAllButtonsOnScreen(page);
  await page.getByRole('button', { name: '시작' }).click();

  // 게임 화면: 내 차례가 오면 직접 선언한다
  await expect(page.locator('canvas')).toBeVisible();

  // E2E는 시간 배율 때문에 공개가 150ms 정도로 짧다. 기다리기 시작하기 전에 지나가 버릴 수 있으므로
  // 게임 내내 판정 요약과 직전 판정 버튼이 나타났는지 기록해 두고 끝에서 확인한다
  type Seen = { summary: string; recall: boolean };
  await page.evaluate(() => {
    const w = window as unknown as { __seen: Seen };
    w.__seen = { summary: '', recall: false };
    new MutationObserver(() => {
      const s = document.querySelector('[data-testid=reveal-summary]');
      if (s && !w.__seen.summary) w.__seen.summary = s.textContent ?? '';
      if (document.querySelector('[data-testid=recall-open]')) w.__seen.recall = true;
    }).observe(document.body, { subtree: true, childList: true });
  });

  // 버튼 위치 검사는 내 차례를 기다리기 전에 한다. 활성화된 뒤 클릭까지 사이가 길면 턴이 지나간다
  const bid = page.getByTestId('bid');
  await expect(bid).toBeVisible();
  await expectAllButtonsOnScreen(page);
  await expect(bid).toBeEnabled({ timeout: 30_000 });
  await bid.click();
  await expect(page.locator('.statusbar .total')).toContainText('9');

  // 이후에는 무입력: 2턴 타임아웃 뒤 자동 진행 (S-07) → 게임 종료
  const result = page.getByTestId('result');
  await expect(result).toBeVisible({ timeout: 150_000 });
  await expect(result.locator('.ranking li')).toHaveCount(3);

  // 공개 중에는 선언 패널 자리에 판정 요약이, 다음 라운드에는 직전 판정 버튼이 나왔어야 한다
  const seen = await page.evaluate(() => (window as unknown as { __seen: Seen }).__seen);
  expect(seen.summary).toMatch(/라이어![\s\S]*와일드/);
  expect(seen.recall).toBe(true);
  await expectAllButtonsOnScreen(page);

  // 리매치하면 같은 방 대기실로 돌아간다
  await result.getByRole('button', { name: '다시 하기' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
});

test('M4: 이전 초대 링크 /r/:code와 저장된 Phase 1 닉네임으로 바로 대기실에 들어간다', async ({
  page,
  browser,
}) => {
  await page.goto('/liars-dice');
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

for (const path of ['/liars-dice', '/liars-dice/r/ABC234', '/r/ABC234']) {
  test(`로비: 게임 규칙 시트를 열고 위아래로 읽은 뒤 닫는다 (${path})`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(path);
    const open = page.getByTestId('rules-open');
    await open.click();

    const sheet = page.getByRole('dialog', { name: '게임 규칙' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('1은 어떤 눈으로도 함께 세요');
    // 본문만 스크롤되고, 끝까지 내리면 마지막 팁이 보인다. 확인 버튼은 그대로 화면 안에 있다
    const body = sheet.locator('.rules-scroll');
    expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(sheet.locator('.rules-tip')).toBeInViewport();
    await expect(sheet.getByRole('button', { name: '알겠어요' })).toBeInViewport();
    await expectAllButtonsOnScreen(page);

    await sheet.getByRole('button', { name: '알겠어요' }).click();
    await expect(sheet).toBeHidden();
    await expect(open).toBeFocused();

    // ESC로도 닫힌다
    await open.click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });
}

test('Phase 2 M1: 메인은 게임만 고르고, 준비 중인 게임은 누를 수 없다', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('WMG · Web Multiplayer Ground');
  await expect(page.getByRole('heading', { name: 'Web Multiplayer Ground' })).toBeVisible();
  await expect(page.getByText('링크 하나로 친구와 바로 하는 미니게임.')).toBeVisible();
  // 닉네임과 방 코드는 게임 로비에서 정한다
  await expect(page.locator('#nickname')).toHaveCount(0);
  await expect(page.locator('#room-code')).toHaveCount(0);

  const dice = page.getByTestId('game-liars-dice');
  await expect(dice).toContainText('내 주사위를 단서로 거짓말을 잡아내요');
  for (const id of ['omok', 'one-card']) {
    const card = page.getByTestId(`game-${id}`);
    await expect(card).toContainText('준비 중');
    await expect(card.getByRole('button')).toHaveCount(0);
  }
  await expectAllButtonsOnScreen(page);

  // 메인 카드에서도 규칙을 볼 수 있다
  await dice.getByRole('button', { name: '거짓말쟁이 주사위 규칙 보기' }).click();
  await expect(page.getByRole('dialog', { name: '거짓말쟁이 주사위 규칙' })).toBeVisible();
  await page.keyboard.press('Escape');

  // 로비 → 게임 목록으로 돌아오기
  await dice.getByRole('button', { name: '거짓말쟁이 주사위 하러 가기' }).click();
  await expect(page.getByRole('heading', { name: '거짓말쟁이 주사위' })).toBeVisible();
  await expect(page.getByText('이 게임에서만 써요')).toBeVisible();
  await page.getByRole('button', { name: '게임 목록' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('game-liars-dice')).toBeVisible();
});

test('Phase 2 M1: 준비 중인 게임 주소는 메인으로 보낸다', async ({ page }) => {
  await page.goto('/omok');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#toast')).toContainText('준비 중인 게임입니다');
});

test('Phase 2 M1: 닉네임은 게임별로 저장된다', async ({ page }) => {
  await page.goto('/liars-dice');
  await setNickname(page, '주사위전용');
  await page.getByRole('button', { name: '방 만들기' }).click();
  await expect(page.getByTestId('room-code')).toBeVisible();
  const stored = await page.evaluate(() => ({
    dice: localStorage.getItem('wmg.liars-dice.nickname'),
    omok: localStorage.getItem('wmg.omok.nickname'),
    legacy: localStorage.getItem('wmg.nickname'),
  }));
  expect(stored).toEqual({ dice: '주사위전용', omok: null, legacy: null });
});

test.describe('고해상도 화면 (DPR 2)', () => {
  test.use({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2 });

  test('게임 테이블 캔버스를 실제 픽셀 수로 그린다 (흐릿하지 않게)', async ({ page }) => {
    await page.goto('/liars-dice');
    await setNickname(page, '선명도');
    await page.getByRole('button', { name: '방 만들기' }).click();
    await page.getByRole('group', { name: '최대 인원' }).getByRole('button', { name: '3' }).click();
    await page.getByRole('button', { name: '시작' }).click();

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    // 캔버스 픽셀 크기 = CSS 크기 × 2. 같으면 1배로 그린 것을 늘려 보여 주는 것이라 흐릿하다
    await expect
      .poll(() =>
        canvas.evaluate((c: HTMLCanvasElement) => [c.width / c.clientWidth, c.height / c.clientHeight]),
      )
      .toEqual([2, 2]);
  });
});

for (const viewport of [
  { width: 360, height: 640 },
  { width: 1280, height: 720 },
]) {
  test(`대기실: 글자가 잘리거나 하단 바에 가려지지 않는다 (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/liars-dice');
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
