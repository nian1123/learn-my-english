import { expect, test, type Page } from "@playwright/test";

const diagnosticRow = (page: Page, label: string) =>
  page.locator(".diagnostic-row").filter({ hasText: label });

function boxesOverlapVertically(
  left: { y: number; height: number },
  right: { y: number; height: number },
) {
  return left.y < right.y + right.height && right.y < left.y + left.height;
}

function boxesOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    boxesOverlapVertically(left, right)
  );
}

test("library summary and import action belong to their section heading rows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_440, height: 1_000 });
  await page.goto("/");

  const libraryTitle = page.getByRole("heading", { name: "我的学习库" });
  const overview = page.getByLabel("学习库概览");
  const recentTitle = page.getByRole("heading", { name: "最近学习" });
  const importButton = page.getByRole("button", { name: "导入视频" });
  await expect(overview.locator("strong")).toHaveText(["0", "0", "0"]);

  const libraryTitleBox = await libraryTitle.boundingBox();
  const overviewBox = await overview.boundingBox();
  const recentTitleBox = await recentTitle.boundingBox();
  const importButtonBox = await importButton.boundingBox();
  expect(libraryTitleBox).not.toBeNull();
  expect(overviewBox).not.toBeNull();
  expect(recentTitleBox).not.toBeNull();
  expect(importButtonBox).not.toBeNull();
  expect(boxesOverlapVertically(libraryTitleBox!, overviewBox!)).toBe(true);
  expect(boxesOverlapVertically(recentTitleBox!, importButtonBox!)).toBe(true);
  expect(overviewBox!.x).toBeGreaterThan(libraryTitleBox!.x);
  expect(importButtonBox!.x).toBeGreaterThan(recentTitleBox!.x);

  await page.setViewportSize({ width: 620, height: 900 });
  await expect(libraryTitle).toBeVisible();
  await expect(overview).toBeVisible();
  await expect(recentTitle).toBeVisible();
  await expect(importButton).toBeVisible();
  const narrowTitleBox = await libraryTitle.boundingBox();
  const narrowOverviewBox = await overview.boundingBox();
  expect(boxesOverlap(narrowTitleBox!, narrowOverviewBox!)).toBe(false);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(620);
});

test("learner can open an empty Study Library and inspect readiness", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "我的学习库" })).toBeVisible();
  await expect(page.getByText("还没有学习视频")).toBeVisible();

  await expect(page.getByLabel("YouTube 视频链接")).toHaveCount(0);
  await page.getByRole("button", { name: "导入视频" }).click();
  await expect(page.getByRole("dialog", { name: "导入 Study Video" })).toBeVisible();
  await expect(page.getByLabel("YouTube 视频链接")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "导入 Study Video" })).toHaveCount(0);

  await page.getByRole("button", { name: "设置与诊断" }).click();

  await expect(page.getByRole("heading", { name: "运行状态" })).toBeVisible();
  await expect(page.getByText("yt-dlp", { exact: true })).toBeVisible();
  await expect(page.getByText("本地 AI", { exact: true })).toBeVisible();
  await expect(page.getByText("DeepSeek", { exact: true })).toBeVisible();
  await expect(page.getByText("基础词典", { exact: true })).toBeVisible();
  await expect(page.getByText("本地数据", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "运行状态" })).toHaveCount(0);
});

test("runtime readiness uses provider boundaries without exposing credentials", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置与诊断" }).click();

  await expect(diagnosticRow(page, "yt-dlp")).toContainText("可用");
  await expect(diagnosticRow(page, "本地 AI")).toContainText("已配置");
  await expect(diagnosticRow(page, "DeepSeek")).toContainText("已配置");
  await expect(diagnosticRow(page, "基础词典")).toContainText("可用");
  await expect(diagnosticRow(page, "本地数据")).toContainText("可用");

  const diagnosticResponse = await page.evaluate(async () =>
    fetch("/api/diagnostics").then((response) => response.text()),
  );

  expect(diagnosticResponse).not.toContain("e2e-local-secret");
  expect(diagnosticResponse).not.toContain("e2e-deepseek-secret");
});

test("missing optional AI does not block the Study Library", async ({ page }) => {
  await page.goto("http://127.0.0.1:3101/");

  await expect(page.getByRole("heading", { name: "我的学习库" })).toBeVisible();
  await page.getByRole("button", { name: "导入视频" }).click();
  await expect(page.getByLabel("YouTube 视频链接")).toBeEnabled();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "设置与诊断" }).click();

  await expect(diagnosticRow(page, "本地 AI")).toContainText("未配置");
  await expect(diagnosticRow(page, "DeepSeek")).toContainText("未配置");
  await expect(
    page.getByRole("alert").filter({ hasText: "本地数据不可用" }),
  ).toHaveCount(0);
});

test("learner preference survives a browser refresh", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置与诊断" }).click();

  const hideTranscript = page.getByRole("checkbox", {
    name: "默认隐藏字幕",
  });

  await expect(hideTranscript).not.toBeChecked();
  await hideTranscript.check();
  await expect(page.getByText("偏好已保存")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "设置与诊断" }).click();
  await expect(hideTranscript).toBeChecked();
});

test("learner sees a blocking error when local data is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: undefined,
    });
  });

  await page.goto("/");

  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "本地数据不可用，暂时不能保存学习内容" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "导入视频" })).toBeDisabled();

  await page.getByRole("button", { name: "设置与诊断" }).click();
  await expect(page.getByText("本地数据不可用，无法保存偏好")).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "默认隐藏字幕" }),
  ).toBeDisabled();
});
