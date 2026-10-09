const { test, expect } = require("@playwright/test");

const nav = (page, route) =>
  page.locator(`.sidebar [data-nav="${route}"]`).first().click();
test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("overview and all pages render without script or asset errors", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  await expect(page.locator("h1")).toContainText("Zakaria");
  await expect(page.locator(".metrics .metric")).toHaveCount(4);
  for (const route of [
    "content",
    "coach",
    "planner",
    "goals",
    "insights",
    "profile",
    "tools",
    "settings",
    "overview",
  ]) {
    await nav(page, route);
    await expect(page.locator("h1")).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("tasks toggle and persist after reload", async ({ page }) => {
  const task = page.locator('[data-task="t2"]');
  await task.click();
  await expect(task).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(task).toHaveAttribute("aria-pressed", "true");
  await task.click();
  await expect(task).toHaveAttribute("aria-pressed", "false");
});

test("chart switches periods and content search/filter works", async ({
  page,
}) => {
  await page.locator('[data-period="30d"]').click();
  await expect(page.locator(".chart-summary strong")).toHaveText("8,452");
  await page.locator('[data-period="7d"]').click();
  await expect(page.locator(".chart-summary strong")).toHaveText("2,819");
  await nav(page, "content");
  await page.locator("#content-search").fill("Marrakech");
  await expect(page.locator("#library-grid .content-card")).toHaveCount(1);
  await page.locator("#content-search").fill("");
  await page.locator('[data-filter="Top rated"]').click();
  await expect(page.locator("#library-grid .content-card")).toHaveCount(2);
  await page.locator('[data-filter="My drafts"]').click();
  await expect(page.locator("#library-grid .empty")).toBeVisible();
});

test("create and score a draft, reload, then delete it", async ({ page }) => {
  await page.locator('[data-action="upload"]').click();
  await page.locator('#upload-form [name="title"]').fill("My local test reel");
  await page.locator('#upload-form [name="views"]').fill("1000");
  await page.locator('#upload-form [type="submit"]').click();
  await expect(page.locator(".modal")).toContainText("My local test reel");
  for (let i = 0; i < 3; i++)
    await page.locator('#review-form [name="criterion"]').nth(i).check();
  await expect(page.locator("#review-score strong")).toHaveText("60");
  await page.locator('#review-form [type="submit"]').click();
  await page.reload();
  const card = page
    .locator(".content-card")
    .filter({ hasText: "My local test reel" });
  await expect(card).toContainText("60/100");
  await card.click();
  await expect(page.locator("#review-form input:checked")).toHaveCount(3);
  await page.locator("[data-delete-content]").click();
  await expect(card).toHaveCount(0);
});

test("video validation rejects non-video files without saving a blob", async ({
  page,
}) => {
  await page.locator('[data-action="upload"]').click();
  await page
    .locator("#video-file")
    .setInputFiles({
      name: "bad.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not video"),
    });
  await expect(page.locator("#toast")).toContainText("Choose an MP4");
  await expect(page.locator("#video-preview video")).toHaveCount(0);
});

test("planner adds a task on a different month, completes and deletes it", async ({
  page,
}) => {
  await nav(page, "planner");
  await page.locator('[data-action="add-task"]').click();
  await page.locator('#task-form [name="title"]').fill("November idea");
  await page.locator('#task-form [name="date"]').fill("2026-11-15");
  await page.locator('#task-form [name="time"]').fill("14:30");
  await page.locator('#task-form [type="submit"]').click();
  await expect(page.locator(".day.active strong")).toHaveText("15");
  const row = page
    .locator(".schedule-row")
    .filter({ hasText: "November idea" });
  await expect(row).toContainText("14:30");
  await row.locator("[data-task]").click();
  await expect(row).toHaveClass(/done/);
  await page.reload();
  await page.locator("#planner-date").fill("2026-11-15");
  await expect(row).toHaveClass(/done/);
  await row.locator("[data-delete-task]").click();
  await expect(row).toHaveCount(0);
});

test("goals can be created, progressed, achieved and persisted", async ({
  page,
}) => {
  await nav(page, "goals");
  await page.locator('[data-action="add-goal"]').click();
  await page.locator('#goal-form [name="title"]').fill("Ten creative reels");
  await page.locator('#goal-form [name="target"]').fill("10");
  await page.locator('#goal-form [name="current"]').fill("2");
  await page.locator('#goal-form [name="unit"]').selectOption("reels");
  await page.locator('#goal-form [type="submit"]').click();
  const goal = page
    .locator(".goal-card")
    .filter({ hasText: "Ten creative reels" });
  await expect(goal).toContainText("20.0%");
  await goal.locator("[data-goal-edit]").click();
  await page.locator('#goal-form [name="current"]').fill("10");
  await page.locator('#goal-form [type="submit"]').click();
  await expect(goal).toHaveClass(/completed/);
  await page.reload();
  await expect(goal.locator("[data-goal-done]")).toBeChecked();
});

test("all template tools return topic-specific output and respond to tone", async ({
  page,
}) => {
  await nav(page, "tools");
  for (const tool of [
    "caption",
    "hooks",
    "stories",
    "bio",
    "hashtags",
    "inspiration",
  ]) {
    await page.locator(`[data-tool="${tool}"]`).click();
    await page.locator('#tool-form [name="topic"]').fill("Morning photography");
    await page.locator('#tool-form [type="submit"]').click();
    await expect(page.locator("#generated-text")).toContainText(
      tool === "hashtags" ? "Morningphotography" : "Morning photography",
    );
    await page.keyboard.press("Escape");
  }
  await page.locator('[data-tool="caption"]').click();
  await page.locator('#tool-form [name="tone"]').selectOption("playful");
  await page.locator('#tool-form [type="submit"]').click();
  await expect(page.locator("#generated-text")).toContainText(
    "officially obsessed",
  );
});

test("coach answers suggested and typed prompts, persists history", async ({
  page,
}) => {
  await nav(page, "coach");
  await page.locator("[data-prompt]").first().click();
  await expect(page.locator(".messages")).toContainText("3–5 reels per week");
  await page.locator("#chat-form input").fill("Help with stories");
  await page.locator("#chat-form button").click();
  await expect(page.locator(".messages")).toContainText("three-story sequence");
  await page.reload();
  await expect(page.locator(".bubble.user")).toHaveCount(2);
  await expect(page.locator(".chat-head")).toContainText(
    "Not connected to an AI model",
  );
});

test("settings escape user input and save profile locally", async ({
  page,
}) => {
  await nav(page, "settings");
  await page.locator('[name="name"]').fill("<img src=x onerror=alert(1)>");
  await page.locator('[name="handle"]').fill("test.creator");
  await page.locator('#settings-form [type="submit"]').click();
  await nav(page, "overview");
  await expect(page.locator("h1")).toContainText(
    "<img src=x onerror=alert(1)>",
  );
  await expect(page.locator("h1 img")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".profile-info h3")).toHaveText("@test.creator");
});

test("search navigates, dialogs trap focus and close with Escape", async ({
  page,
}) => {
  await page.locator('[data-action="search"]').click();
  await page.locator("#global-search").fill("Growth");
  await page.locator('#search-results [data-nav="goals"]').click();
  await expect(page).toHaveURL(/#goals$/);
  await page.locator('[data-action="add-goal"]').click();
  await page.locator(".modal .close").focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator('#goal-form [type="submit"]')).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator(".modal .close")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".modal")).toHaveCount(0);
  await expect(page.locator('[data-action="add-goal"]')).toBeFocused();
});

test("export downloads actual workspace and reset restores demo", async ({
  page,
}) => {
  await nav(page, "settings");
  const download = page.waitForEvent("download");
  await page.locator('[data-action="export"]').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("neurio-workspace.json");
  const stream = await file.createReadStream();
  let data = "";
  for await (const chunk of stream) data += chunk;
  expect(JSON.parse(data).profile.name).toBe("Zakaria");
  await page.locator('[data-action="reset"]').click();
  await page.locator('[data-action="confirm-reset"]').click();
  await expect(page).toHaveURL(/#overview$/);
  await expect(page.locator("h1")).toContainText("Zakaria");
});

test("mobile navigation, RTL, and all page layouts fit the screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator(".mobile-bottom-nav")).toBeVisible();
  for (const lang of ["en", "ar"]) {
    if (lang === "ar") await page.locator('[data-action="language"]').click();
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      lang === "ar" ? "rtl" : "ltr",
    );
    for (const route of [
      "overview",
      "content",
      "coach",
      "planner",
      "goals",
      "insights",
      "profile",
      "tools",
      "settings",
    ]) {
      await page.locator('[data-action="menu"]').click();
      await nav(page, route);
      await expect(page.locator(".mobile-overlay")).not.toHaveClass(/show/);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expect(page.locator("h1")).toBeVisible();
    }
  }
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
});

test("offline shell remains usable after a first visit", async ({
  page,
  context,
}) => {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, {
          once: true,
        }),
      );
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("h1")).toContainText("Zakaria");
  await nav(page, "planner");
  await expect(page.locator(".schedule-row")).toHaveCount(3);
  await context.setOffline(false);
});

test("small 320px screens fit in both languages", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  for (const language of ["en", "ar"]) {
    if (language === "ar")
      await page.locator('[data-action="language"]').click();
    for (const route of [
      "overview",
      "content",
      "coach",
      "planner",
      "goals",
      "insights",
      "profile",
      "tools",
      "settings",
    ]) {
      await page.locator('[data-action="menu"]').click();
      await nav(page, route);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
});

test("Instagram integration is clearly not represented as connected", async ({
  page,
}) => {
  await page.locator('[data-action="connect"]').click();
  await expect(page.locator(".modal")).toContainText(
    "isn’t connected to Instagram yet",
  );
  await expect(page.locator(".modal")).toContainText(
    "We never ask for your Instagram password",
  );
  await page.locator('.modal [data-action="workspace"]').click();
  await expect(page.locator(".modal")).toContainText(
    "don’t connect to Instagram",
  );
  await expect(page.locator('.modal input[type="password"]')).toHaveCount(0);
});
