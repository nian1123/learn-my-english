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

      setCurrentTime(seconds: number) {
        this.currentTime = seconds;
      }
    }

    const calls: Array<{ method: string; seconds?: number }> = [];
    let currentPlayer: FakeYouTubePlayer | null = null;
    const recordCall = (method: string, seconds?: number) => {
      calls.push(seconds === undefined ? { method } : { method, seconds });
    };

    const OriginalPlayer = FakeYouTubePlayer;
    const Player = class extends OriginalPlayer {
      constructor(element: string | HTMLElement, playerOptions: PlayerOptions) {
        super(element, playerOptions);
        currentPlayer = this;
      }
    };

    Reflect.set(window, "__youtubePlayerCalls", calls);
    Reflect.set(window, "__setYouTubeCurrentTime", (seconds: number) => {
      currentPlayer?.setCurrentTime(seconds);
    });
    Reflect.set(window, "YT", {
      Player,
      PlayerState: { CUED: 5, PLAYING: 1 },
    });
  }, options);
}

async function submitStudyVideoImport(
  page: Page,
  fixture: {
    contents?: string;
    fileName?: string;
    mimeType?: string;
    videoUrl?: string;
  } = {},
) {
  await page.goto("/");
  await page
    .getByLabel("YouTube 视频链接")
    .fill(fixture.videoUrl ?? VALID_VIDEO_URL);
  await page.getByLabel("Caption Source 文件").setInputFiles({
    name: fixture.fileName ?? "interview.vtt",
    mimeType: fixture.mimeType ?? "text/vtt",
    buffer: Buffer.from(fixture.contents ?? CAPTION_SOURCE),
  });
  await page.getByRole("button", { name: "导入视频" }).click();
}

test("learner imports a Study Video with a VTT Caption Source", async ({
  page,
}) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page);

  await expect(
    page.getByRole("heading", { name: "The Daily American Interview" }),
  ).toBeVisible();
  await expect(page.getByText("Welcome to the show.")).toBeVisible();
  await expect(
    page.getByText("Today we're talking about practice."),
  ).toBeVisible();

  await page.getByRole("button", { name: "播放第 2 句" }).click();
  await page.evaluate(() => Reflect.get(window, "__setYouTubeCurrentTime")(7));
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "__youtubePlayerCalls")),
    )
    .toEqual([
      { method: "seekTo", seconds: 4 },
      { method: "playVideo" },
      { method: "pauseVideo" },
    ]);

  await page.evaluate(() => Reflect.get(window, "__setYouTubeCurrentTime")(11));
  await expect(page.getByText("上次位置 0:11")).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "The Daily American Interview" }),
  ).toBeVisible();
  await expect(page.getByText("Welcome to the show.")).toBeVisible();
  await expect(page.getByText("上次位置 0:11")).toBeVisible();

  await page.getByRole("link", { name: "返回学习库" }).click();
  await expect(
    page.getByRole("heading", { name: "The Daily American Interview" }),
  ).toBeVisible();
  await expect(page.getByText("Everyday Voices")).toBeVisible();
  await expect(page.getByText("1:14")).toBeVisible();
  await expect(page.getByText("上次位置 0:11")).toBeVisible();
});

test("caption fragments become punctuation and three-second Learning Sentences", async ({
  page,
}) => {
  const fragmentedCaptionSource = `WEBVTT

00:00:01.000 --> 00:00:02.000
Welcome

00:00:02.200 --> 00:00:03.000
to the show.

00:00:07.000 --> 00:00:08.000
Next thought

00:00:12.000 --> 00:00:16.000
One cue can contain a sentence. It can contain another one!

00:00:18.000 --> 00:00:20.000
Dr. Smith spoke.

00:00:22.000 --> 00:00:24.000
I live in the U.S. It is large.

00:00:26.000 --> 00:00:28.000
We reached Main St. Traffic was heavy.

00:00:30.000 --> 00:00:32.000
The U.S. Government spoke.

00:00:34.000 --> 00:00:36.000
Meet Dr. Smith.

00:00:38.000 --> 00:00:40.000
Visit St. Paul.

00:00:42.000 --> 00:00:44.000
We visited North St. Paul.
`;

  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page, {
    contents: fragmentedCaptionSource,
    fileName: "fragments.vtt",
  });

  await expect(page.getByText("Welcome to the show.")).toBeVisible();
  await expect(page.getByText("Next thought")).toBeVisible();
  await expect(page.getByText("One cue can contain a sentence.")).toBeVisible();
  await expect(page.getByText("It can contain another one!")).toBeVisible();
  await expect(page.getByText("Dr. Smith spoke.", { exact: true })).toBeVisible();
  await expect(page.getByText("I live in the U.S.", { exact: true })).toBeVisible();
  await expect(page.getByText("It is large.", { exact: true })).toBeVisible();
  await expect(page.getByText("We reached Main St.", { exact: true })).toBeVisible();
  await expect(page.getByText("Traffic was heavy.", { exact: true })).toBeVisible();
  await expect(
    page.getByText("The U.S. Government spoke.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Meet Dr. Smith.", { exact: true })).toBeVisible();
  await expect(page.getByText("Visit St. Paul.", { exact: true })).toBeVisible();
  await expect(
    page.getByText("We visited North St. Paul.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("13 句")).toBeVisible();

  await page.getByRole("button", { name: "播放第 3 句" }).click();
  await page.evaluate(() => Reflect.get(window, "__setYouTubeCurrentTime")(15));
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "__youtubePlayerCalls")),
    )
    .toEqual([
      { method: "seekTo", seconds: 12 },
      { method: "playVideo" },
      { method: "pauseVideo" },
    ]);
  await page.evaluate(() =>
    Reflect.get(window, "__youtubePlayerCalls").splice(0),
  );

  await page.getByRole("button", { name: "播放第 4 句" }).click();
  const playerCalls = await page.evaluate(() =>
    Reflect.get(window, "__youtubePlayerCalls"),
  );
  expect(playerCalls[0].method).toBe("seekTo");
  expect(playerCalls[0].seconds).toBeGreaterThan(12);
  expect(playerCalls[0].seconds).toBeLessThan(16);
});

test("learner is warned when the Caption Source content type is unsupported", async ({
  page,
}) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page, {
    fileName: "disguised.vtt",
    mimeType: "image/png",
  });

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

  await submitStudyVideoImport(page, {
    contents: partiallyMalformedCaptionSource,
    fileName: "partially-malformed.vtt",
  });

  await expect(
    page.getByRole("alert").filter({ hasText: "第 3 个时间段无效" }),
  ).toBeVisible();
  await expect(page.getByText("还没有学习视频")).toBeVisible();
});

test("learner imports an SRT Caption Source", async ({ page }) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page, {
    contents: SRT_CAPTION_SOURCE,
    fileName: "interview.srt",
    mimeType: "application/x-subrip",
  });

  await expect(page.getByText("Welcome from the SRT source.")).toBeVisible();
  await expect(
    page.getByText("学习者提供的 Caption Source · SRT"),
  ).toBeVisible();
});

test("learner is given a supported URL example for an invalid URL", async ({
  page,
}) => {
  await submitStudyVideoImport(page, {
    videoUrl: "https://www.youtube.com/playlist?list=not-a-video",
  });

  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "请使用 youtube.com/watch?v=… 或 youtu.be/… 链接" }),
  ).toBeVisible();
  await expect(page.getByText("还没有学习视频")).toBeVisible();
});

test("syntactically invalid URL receives the app's Chinese guidance", async ({
  page,
}) => {
  await submitStudyVideoImport(page, { videoUrl: "not a url" });

  await expect(
    page.getByRole("alert").filter({ hasText: "请输入完整的 YouTube 视频链接" }),
  ).toBeVisible();
});

test("out-of-range timestamps are rejected", async ({ page }) => {
  const malformedTimestampSource = `WEBVTT

00:99:99.000 --> 02:00:00.000
This timestamp is not valid.
`;

  await submitStudyVideoImport(page, {
    contents: malformedTimestampSource,
    fileName: "invalid-time.vtt",
  });

  await expect(
    page.getByRole("alert").filter({ hasText: "第 1 个时间段无效" }),
  ).toBeVisible();
});

test("an invalid WEBVTT signature is rejected", async ({ page }) => {
  const invalidSignatureSource = `WEBVTTjunk

00:00:01.000 --> 00:00:02.000
This is not a valid WebVTT file.
`;

  await submitStudyVideoImport(page, {
    contents: invalidSignatureSource,
    fileName: "invalid-signature.vtt",
  });

  await expect(
    page.getByRole("alert").filter({ hasText: "VTT 文件缺少 WEBVTT 文件头" }),
  ).toBeVisible();
});

test("SRT timestamps must include hours", async ({ page }) => {
  const hourlessSrtSource = `1
00:01,000 --> 00:03,000
SRT needs an hours field.
`;

  await submitStudyVideoImport(page, {
    contents: hourlessSrtSource,
    fileName: "hourless.srt",
    mimeType: "application/x-subrip",
  });

  await expect(
    page.getByRole("alert").filter({ hasText: "第 1 个时间段无效" }),
  ).toBeVisible();
});

test("non-embeddable video is rejected without a partial Study Video", async ({
  page,
}) => {
  await installYouTubePlayerBoundary(page, { duration: 74, errorCode: 101 });
  await submitStudyVideoImport(page);

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
  await submitStudyVideoImport(page);

  await expect(
    page.getByRole("alert").filter({ hasText: "视频超过 3 小时" }),
  ).toBeVisible();
  await expect(page.getByText("还没有学习视频")).toBeVisible();
});

test("canceling a slow import leaves no partial Study Video", async ({ page }) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page, {
    videoUrl: "https://youtu.be/slowvideo01",
  });

  await expect(page.getByText("正在读取视频信息…")).toBeVisible();
  await page.getByRole("button", { name: "取消导入" }).click();
  await page.waitForTimeout(1_800);

  await expect(page.getByText("还没有学习视频")).toBeVisible();
  await expect(page.getByRole("button", { name: "导入视频" })).toBeEnabled();
});
