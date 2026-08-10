import { expect, test, type Page } from "@playwright/test";

const VALID_VIDEO_URL = "https://youtu.be/dQw4w9WgXcQ";

const CAPTION_SOURCE = `WEBVTT

00:00:01.000 --> 00:00:03.500
Welcome to the show.

00:00:04.000 --> 00:00:07.000
Today we're talking about practice.
`;

const SRT_CAPTION_SOURCE = `1
00:00:01,000 --> 00:00:03,500
Welcome from the SRT source.

2
00:00:04,000 --> 00:00:07,000
This timing should also be preserved.
`;

async function installYouTubePlayerBoundary(
  page: Page,
  options: { duration: number; errorCode?: number },
) {
  await page.route("https://www.youtube.com/iframe_api", async (route) => {
    await route.fulfill({
      body: "window.onYouTubeIframeAPIReady?.();",
      contentType: "application/javascript",
    });
  });

  await page.addInitScript((fixture) => {
    type PlayerEvents = {
      onError?: (event: { data: number }) => void;
      onReady?: (event: { target: FakeYouTubePlayer }) => void;
    };

    type PlayerOptions = {
      events?: PlayerEvents;
    };

    class FakeYouTubePlayer {
      private currentTime = 0;

      constructor(
        _element: string | HTMLElement,
        private readonly playerOptions: PlayerOptions,
      ) {
        queueMicrotask(() => {
          if (fixture.errorCode) {
            this.playerOptions.events?.onError?.({ data: fixture.errorCode });
            return;
          }

          this.playerOptions.events?.onReady?.({ target: this });
        });
      }

      destroy() {}

      getCurrentTime() {
        return this.currentTime;
      }

      getDuration() {
        return fixture.duration;
      }

      pauseVideo() {
        recordCall("pauseVideo");
      }

      playVideo() {
        recordCall("playVideo");
      }

      seekTo(seconds: number) {
        this.currentTime = seconds;
        recordCall("seekTo", seconds);
      }
    }

    const calls: Array<{ method: string; seconds?: number }> = [];
    const recordCall = (method: string, seconds?: number) => {
      calls.push({ method, seconds });
    };

    Reflect.set(window, "__youtubePlayerCalls", calls);
    Reflect.set(window, "YT", {
      Player: FakeYouTubePlayer,
      PlayerState: { CUED: 5, PLAYING: 1 },
    });
  }, options);
}

test("learner imports a Study Video with a VTT Caption Source", async ({
  page,
}) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await page.goto("/");

  await page.getByLabel("YouTube 视频链接").fill(VALID_VIDEO_URL);
  await expect(page.getByLabel("Caption Source 文件")).toBeVisible();
  await page.getByLabel("Caption Source 文件").setInputFiles({
    name: "interview.vtt",
    mimeType: "text/vtt",
    buffer: Buffer.from(CAPTION_SOURCE),
  });
  await page.getByRole("button", { name: "导入视频" }).click();

  await expect(
    page.getByRole("heading", { name: "The Daily American Interview" }),
  ).toBeVisible();
  await expect(page.getByText("Welcome to the show.")).toBeVisible();
  await expect(
    page.getByText("Today we're talking about practice."),
  ).toBeVisible();

  await page.getByRole("button", { name: "播放第 2 句" }).click();
  const playerCalls = await page.evaluate(() =>
    Reflect.get(window, "__youtubePlayerCalls"),
  );
  expect(playerCalls).toEqual([
    { method: "seekTo", seconds: 4 },
    { method: "playVideo" },
  ]);
  await expect(page.getByText("上次位置 0:04")).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "The Daily American Interview" }),
  ).toBeVisible();
  await expect(page.getByText("Welcome to the show.")).toBeVisible();
  await expect(page.getByText("上次位置 0:04")).toBeVisible();

  await page.getByRole("link", { name: "返回学习库" }).click();
  await expect(
    page.getByRole("heading", { name: "The Daily American Interview" }),
  ).toBeVisible();
  await expect(page.getByText("Everyday Voices")).toBeVisible();
  await expect(page.getByText("1:14")).toBeVisible();
  await expect(page.getByText("上次位置 0:04")).toBeVisible();
});

test("learner is warned when the Caption Source content type is unsupported", async ({
  page,
}) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await page.goto("/");

  await page.getByLabel("YouTube 视频链接").fill(VALID_VIDEO_URL);
  await page.getByLabel("Caption Source 文件").setInputFiles({
    name: "disguised.vtt",
    mimeType: "image/png",
    buffer: Buffer.from(CAPTION_SOURCE),
  });
  await page.getByRole("button", { name: "导入视频" }).click();

  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "文件内容类型 image/png 不受支持" }),
  ).toBeVisible();
  await expect(page.getByText("还没有学习视频")).toBeVisible();
});

test("learner gets a localized error for a malformed Caption Source block", async ({
  page,
}) => {
  const partiallyMalformedCaptionSource = `${CAPTION_SOURCE}

00:broken --> 00:00:09.000
This cue must not be silently dropped.
`;

  await page.goto("/");
  await page.getByLabel("YouTube 视频链接").fill(VALID_VIDEO_URL);
  await page.getByLabel("Caption Source 文件").setInputFiles({
    name: "partially-malformed.vtt",
    mimeType: "text/vtt",
    buffer: Buffer.from(partiallyMalformedCaptionSource),
  });
  await page.getByRole("button", { name: "导入视频" }).click();

  await expect(
    page.getByRole("alert").filter({ hasText: "第 3 个区块缺少有效时间轴" }),
  ).toBeVisible();
  await expect(page.getByText("还没有学习视频")).toBeVisible();
});

test("learner imports an SRT Caption Source", async ({ page }) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await page.goto("/");
  await page.getByLabel("YouTube 视频链接").fill(VALID_VIDEO_URL);
  await page.getByLabel("Caption Source 文件").setInputFiles({
    name: "interview.srt",
    mimeType: "application/x-subrip",
    buffer: Buffer.from(SRT_CAPTION_SOURCE),
  });
  await page.getByRole("button", { name: "导入视频" }).click();

  await expect(page.getByText("Welcome from the SRT source.")).toBeVisible();
  await expect(
    page.getByText("学习者提供的 Caption Source · SRT"),
  ).toBeVisible();
});

test("learner is given a supported URL example for an invalid URL", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("YouTube 视频链接")
    .fill("https://www.youtube.com/playlist?list=not-a-video");
  await page.getByLabel("Caption Source 文件").setInputFiles({
    name: "interview.vtt",
    mimeType: "text/vtt",
    buffer: Buffer.from(CAPTION_SOURCE),
  });
  await page.getByRole("button", { name: "导入视频" }).click();

  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "请使用 youtube.com/watch?v=… 或 youtu.be/… 链接" }),
  ).toBeVisible();
  await expect(page.getByText("还没有学习视频")).toBeVisible();
});

test("non-embeddable video is rejected without a partial Study Video", async ({
  page,
}) => {
  await installYouTubePlayerBoundary(page, { duration: 74, errorCode: 101 });
  await page.goto("/");
  await page.getByLabel("YouTube 视频链接").fill(VALID_VIDEO_URL);
  await page.getByLabel("Caption Source 文件").setInputFiles({
    name: "interview.vtt",
    mimeType: "text/vtt",
    buffer: Buffer.from(CAPTION_SOURCE),
  });
  await page.getByRole("button", { name: "导入视频" }).click();

  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "视频所有者不允许嵌入" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "在 YouTube 打开" })).toBeVisible();
  await expect(page.getByText("还没有学习视频")).toBeVisible();
});

test("video over three hours is rejected without a partial Study Video", async ({
  page,
}) => {
  await installYouTubePlayerBoundary(page, { duration: 10_801 });
  await page.goto("/");
  await page.getByLabel("YouTube 视频链接").fill(VALID_VIDEO_URL);
  await page.getByLabel("Caption Source 文件").setInputFiles({
    name: "interview.vtt",
    mimeType: "text/vtt",
    buffer: Buffer.from(CAPTION_SOURCE),
  });
  await page.getByRole("button", { name: "导入视频" }).click();

  await expect(
    page.getByRole("alert").filter({ hasText: "视频超过 3 小时" }),
  ).toBeVisible();
  await expect(page.getByText("还没有学习视频")).toBeVisible();
});

test("canceling a slow import leaves no partial Study Video", async ({ page }) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await page.goto("/");
  await page
    .getByLabel("YouTube 视频链接")
    .fill("https://youtu.be/slowvideo01");
  await page.getByLabel("Caption Source 文件").setInputFiles({
    name: "interview.vtt",
    mimeType: "text/vtt",
    buffer: Buffer.from(CAPTION_SOURCE),
  });
  await page.getByRole("button", { name: "导入视频" }).click();

  await expect(page.getByText("正在读取视频信息…")).toBeVisible();
  await page.getByRole("button", { name: "取消导入" }).click();
  await page.waitForTimeout(1_800);

  await expect(page.getByText("还没有学习视频")).toBeVisible();
  await expect(page.getByRole("button", { name: "导入视频" })).toBeEnabled();
});
