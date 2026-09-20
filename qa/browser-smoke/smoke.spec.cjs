const { test, expect } = require("@playwright/test");

function captureRuntimeIssues(page) {
  const consoleErrors = [];
  const pageErrors = [];
  const failedCriticalResources = [];
  const criticalPath = /(?:^|\/)(?:index\.html|game\.js|style\.css)(?:\?.*)?$/;
  const isCritical = pathname => pathname === "/" || criticalPath.test(pathname);
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("requestfailed", request => {
    if (isCritical(new URL(request.url()).pathname)) failedCriticalResources.push(request.url());
  });
  page.on("response", response => {
    if (response.status() >= 400 && isCritical(new URL(response.url()).pathname)) {
      failedCriticalResources.push(`${response.status()} ${response.url()}`);
    }
  });
  return { consoleErrors, pageErrors, failedCriticalResources };
}

async function assertNoRuntimeIssues(issues) {
  expect(issues.consoleErrors, "unexpected console.error output").toEqual([]);
  expect(issues.pageErrors, "unexpected uncaught page errors").toEqual([]);
  expect(issues.failedCriticalResources, "critical game resource failed").toEqual([]);
}

async function startGame(page) {
  await page.goto("/");
  await expect(page.locator("#start-overlay")).toBeVisible();
  await expect(page.locator("#start-game")).toBeEnabled();
  await page.locator("#start-game").click();
  await expect(page.locator("#start-overlay")).toBeHidden();
  await expect(page.locator("#board")).toBeVisible();
  // START buttonのフォーカスを外し、以降のキー入力をゲームへ届ける。
  await page.locator("#board").click({ position: { x: 150, y: 300 } });
  await expect(page.locator("#hold")).toBeVisible();
  await expect(page.locator("#next")).toBeVisible();
  await expect(page.locator("#dual-board-test")).toBeHidden();
  await expect(page.locator("#score")).toHaveText("0");
  await expect(page.locator("#level")).toHaveText("1");
  await expect(page.locator("#lines")).toHaveText("0 / 150");
}

async function canvasHasPixels(locator) {
  return locator.evaluate(canvas => {
    const context = canvas.getContext("2d");
    if (!context) return false;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] || pixels[index + 1] || pixels[index + 2]) return true;
    }
    return false;
  });
}

test("startup and primary controls remain playable", async ({ page }) => {
  const issues = captureRuntimeIssues(page);
  await startGame(page);
  const board = page.locator("#board");
  expect(await board.evaluate(canvas => ({ width: canvas.width, height: canvas.height }))).toEqual({ width: 300, height: 600 });
  expect(await canvasHasPixels(board)).toBe(true);

  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("z");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press(" ");
  await expect(board).toBeVisible();
  await expect(page.locator("#status")).toHaveText("プレイ中");
  await assertNoRuntimeIssues(issues);
});

test("HOLD, NEXT, pause, resume and restart stay consistent", async ({ page }) => {
  const issues = captureRuntimeIssues(page);
  await startGame(page);
  const hold = page.locator("#hold");
  await page.keyboard.press("c");
  const heldPreview = await hold.evaluate(canvas => canvas.toDataURL());
  expect(heldPreview.length).toBeGreaterThan(100);
  await page.keyboard.press("c");

  const next = page.locator("#next");
  const nextBeforeDrop = await next.evaluate(canvas => canvas.toDataURL());
  await page.keyboard.press(" ");
  const nextAfterDrop = await next.evaluate(canvas => canvas.toDataURL());
  expect(nextAfterDrop).not.toBe(nextBeforeDrop);
  await page.keyboard.press("p");
  await expect(page.locator("#pause-visual")).toBeVisible();
  await expect(page.locator("#status")).toHaveText("一時停止中");
  await page.keyboard.press("p");
  await expect(page.locator("#pause-visual")).toBeHidden();
  await expect(page.locator("#status")).toHaveText("プレイ中");

  await page.keyboard.press("r");
  await expect(page.locator("#score")).toHaveText("0");
  await expect(page.locator("#lines")).toHaveText("0 / 150");
  await expect(page.locator("#level")).toHaveText("1");
  await expect(page.locator("#status")).toHaveText("プレイ中");
  await assertNoRuntimeIssues(issues);
});

test("DEV TOOLS LOAD 149 to 150 completes Marathon and shows final Results", async ({ page }) => {
  const issues = captureRuntimeIssues(page);
  await startGame(page);
  await page.locator("#open-dev-tools").click();
  await expect(page.locator("#qa-overlay")).toBeVisible();
  await page.locator("#qa-149").click();
  await expect(page.locator("#qa-overlay")).toBeHidden();
  await page.locator("#board").click({ position: { x: 150, y: 300 } });
  await page.keyboard.press(" ");
  await expect(page.locator("#results")).toBeVisible();
  await expect(page.locator("#results-title")).toHaveText("MARATHON COMPLETE");
  await expect(page.locator("#lines")).toHaveText(/^(150|15[1-9]|1[6-9][0-9]|[2-9][0-9]{2,}) \/ 150$/);
  await expect(page.locator("#results-lines")).toHaveText(/^(150|15[1-9]|1[6-9][0-9]|[2-9][0-9]{2,})$/);
  await expect(page.locator("#results-score")).toHaveText(/^[1-9][0-9]*$/);
  await expect(page.locator("#results-perfect-clears")).toHaveText(/^\d+$/);
  await expect(page.locator("#pause")).toBeDisabled();
  await assertNoRuntimeIssues(issues);
});

test("DEV TOOLS DUAL BOARD TEST renders an isolated second player view", async ({ page }) => {
  const issues = captureRuntimeIssues(page);
  await startGame(page);
  await page.locator("#open-dev-tools").click();
  await expect(page.locator("#qa-overlay")).toBeVisible();
  await page.locator("#qa-dual").click();
  await expect(page.locator("#qa-overlay")).toBeHidden();
  await expect(page.locator("#dual-board-test")).toBeVisible();
  await expect(page.locator("#board")).toBeVisible();
  await expect(page.locator("#second-board")).toBeVisible();

  const boardBoxes = await Promise.all([page.locator("#board").boundingBox(), page.locator("#second-board").boundingBox()]);
  expect(boardBoxes[0]).not.toBeNull();
  expect(boardBoxes[1]).not.toBeNull();
  expect(boardBoxes[0].x + boardBoxes[0].width <= boardBoxes[1].x || boardBoxes[1].x + boardBoxes[1].width <= boardBoxes[0].x
    || boardBoxes[0].y + boardBoxes[0].height <= boardBoxes[1].y || boardBoxes[1].y + boardBoxes[1].height <= boardBoxes[0].y).toBe(true);
  expect(await canvasHasPixels(page.locator("#board"))).toBe(true);
  expect(await canvasHasPixels(page.locator("#second-board"))).toBe(true);

  await page.locator("#board").click({ position: { x: 150, y: 300 } });
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press(" ");
  await expect(page.locator("#second-board")).toBeVisible();
  expect(await canvasHasPixels(page.locator("#second-board"))).toBe(true);

  await page.keyboard.press("p");
  await expect(page.locator("#pause-visual")).toBeVisible();
  await page.keyboard.press("p");
  await expect(page.locator("#pause-visual")).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 600 });
  await expect(page.locator("#second-board")).toBeVisible();
  await assertNoRuntimeIssues(issues);
});

test("DEV TOOLS CPU TEST runs an isolated CPU player", async ({ page }) => {
  const issues = captureRuntimeIssues(page);
  await startGame(page);
  await page.locator("#open-dev-tools").click();
  await expect(page.locator("#qa-overlay")).toBeVisible();
  await page.locator("#qa-cpu").click();
  await expect(page.locator("#qa-overlay")).toBeHidden();
  await expect(page.locator("#board")).toBeVisible();
  await expect(page.locator("#second-board")).toBeVisible();
  await expect(page.locator("#second-status")).toContainText("CPU v0.1");
  await expect.poll(async () => Number(await page.locator("#second-score").textContent()), { timeout: 4000 }).toBeGreaterThan(0);
  await page.keyboard.press("p");
  await expect(page.locator("#pause-visual")).toBeVisible();
  await page.keyboard.press("p");
  await expect(page.locator("#pause-visual")).toBeHidden();
  await assertNoRuntimeIssues(issues);
});
