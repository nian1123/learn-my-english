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

const LONG_CAPTION_SOURCE = `WEBVTT

${Array.from({ length: 30 }, (_, index) => {
  const sentenceNumber = index + 1;
  const startSeconds = sentenceNumber * 2 - 1;
  const endSeconds = startSeconds + 1.5;
  const formatTimestamp = (seconds: number) => {
    const wholeSeconds = Math.floor(seconds);
    const minutes = Math.floor(wholeSeconds / 60);
    const secondsWithinMinute = wholeSeconds % 60;
    const milliseconds = Math.round((seconds - wholeSeconds) * 1_000);
    return `00:${String(minutes).padStart(2, "0")}:${String(secondsWithinMinute).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
  };

  return `${formatTimestamp(startSeconds)} --> ${formatTimestamp(endSeconds)}\nPractice sentence ${sentenceNumber}.`;
}).join("\n\n")}
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
      if (!currentPlayer) return false;
      currentPlayer.setCurrentTime(seconds);
      return true;
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
    uploadCaption?: boolean;
    videoUrl?: string;
  } = {},
) {
  const uploadCaption = fixture.uploadCaption ?? true;
  await page.goto("/");
  await page.getByRole("button", { name: "导入视频" }).click();
  await page
    .getByLabel("YouTube 视频链接")
    .fill(
      fixture.videoUrl ??
        (uploadCaption ? "https://youtu.be/nocaptions1" : VALID_VIDEO_URL),
    );
  await page.getByRole("button", { name: "开始导入" }).click();

  if (uploadCaption) {
    await page.getByLabel("Caption Source 文件").setInputFiles({
      name: fixture.fileName ?? "interview.vtt",
      mimeType: fixture.mimeType ?? "text/vtt",
      buffer: Buffer.from(fixture.contents ?? CAPTION_SOURCE),
    });
    await page.getByRole("button", { name: "使用字幕文件继续" }).click();
  }
}

test("learner starts automatic caption import with only a YouTube URL", async ({
  page,
}) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await page.goto("/");
  await page.getByRole("button", { name: "导入视频" }).click();

  await expect(page.getByLabel("Caption Source 文件")).toHaveCount(0);
  await page.getByLabel("YouTube 视频链接").fill(VALID_VIDEO_URL);
  await page.getByRole("button", { name: "开始导入" }).click();

  await expect(
    page.getByRole("heading", { name: "The Daily American Interview" }),
  ).toBeVisible();
  await expect(page.getByText("Welcome to the show.")).toBeVisible();
  await expect(page.getByText("Manual captions", { exact: true })).toBeVisible();
});

test("automatic English captions are used when manual captions are absent", async ({
  page,
}) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await page.goto("/");
  await page.getByRole("button", { name: "导入视频" }).click();
  await page
    .getByLabel("YouTube 视频链接")
    .fill("https://youtu.be/autocaps001");
  await page.getByRole("button", { name: "开始导入" }).click();

  await expect(page.getByText("Practice with automatic captions.")).toBeVisible();
  await expect(page.getByText("Next sentence.", { exact: true })).toBeVisible();
  await expect(page.locator(".learning-sentence strong")).toHaveText([
    "Practice with automatic captions.",
    "Next sentence.",
  ]);
  await expect(page.getByText("2 句")).toBeVisible();
  await expect(
    page.getByText("Auto-generated captions", { exact: true }),
  ).toBeVisible();
});

test("manual Caption Source is offered only after automatic acquisition fails", async ({
  page,
}) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await page.goto("/");
  await page.getByRole("button", { name: "导入视频" }).click();
  await page
    .getByLabel("YouTube 视频链接")
    .fill("https://youtu.be/nocaptions1");
  await page.getByRole("button", { name: "开始导入" }).click();

  await expect(
    page.getByRole("alert").filter({ hasText: "没有找到可用的英文字幕" }),
  ).toBeVisible();
  await page.getByLabel("Caption Source 文件").setInputFiles({
    name: "fallback.vtt",
    mimeType: "text/vtt",
    buffer: Buffer.from(CAPTION_SOURCE),
  });
  await page.getByRole("button", { name: "使用字幕文件继续" }).click();

  await expect(page.getByText("Welcome to the show.")).toBeVisible();
  await expect(
    page.getByText("学习者提供的 Caption Source · VTT", { exact: true }),
  ).toBeVisible();
});

test("import exposes every required processing stage", async ({ page }) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await page.goto("/");
  await page.getByRole("button", { name: "导入视频" }).click();
  await page
    .getByLabel("YouTube 视频链接")
    .fill("https://youtu.be/slowvideo01");
  await page.getByRole("button", { name: "开始导入" }).click();

  await expect(page.getByText("正在读取视频信息…")).toBeVisible();
  const stages = page.getByRole("list", { name: "导入阶段" });
  await expect(stages).toContainText("读取元数据");
  await expect(stages).toContainText("检查可嵌入性");
  await expect(stages).toContainText("获取字幕");
  await expect(stages).toContainText("解析字幕");
  await expect(stages).toContainText("生成学习句");
  await expect(stages).toContainText("保存");

  await page.getByRole("button", { name: "取消导入" }).click();
});

test("yt-dlp failure identifies the caption stage and offers file fallback", async ({
  page,
}) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await page.goto("/");
  await page.getByRole("button", { name: "导入视频" }).click();
  await page
    .getByLabel("YouTube 视频链接")
    .fill("https://youtu.be/failure0001");
  await page.getByRole("button", { name: "开始导入" }).click();

  await expect(
    page.getByRole("alert").filter({ hasText: "yt-dlp 获取字幕失败" }),
  ).toBeVisible();
  await expect(page.getByLabel("Caption Source 文件")).toBeVisible();
  await expect(
    page.getByRole("list", { name: "导入阶段" }).locator("li.failed"),
  ).toContainText("获取字幕");
});

test("caption acquisition timeout offers manual VTT or SRT fallback", async ({
  page,
}) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await page.goto("http://127.0.0.1:3103/");
  await page.getByRole("button", { name: "导入视频" }).click();
  await page
    .getByLabel("YouTube 视频链接")
    .fill("https://youtu.be/timeout0001");
  await page.getByRole("button", { name: "开始导入" }).click();

  await expect(
    page.getByRole("alert").filter({ hasText: "自动获取英文字幕超时" }),
  ).toBeVisible();
  await expect(page.getByLabel("Caption Source 文件")).toBeVisible();
});

test("missing yt-dlp offers installation guidance and file fallback", async ({
  page,
}) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await page.goto("http://127.0.0.1:3102/");
  await page.getByRole("button", { name: "导入视频" }).click();
  await page.getByLabel("YouTube 视频链接").fill(VALID_VIDEO_URL);
  await page.getByRole("button", { name: "开始导入" }).click();

  await expect(
    page.getByRole("alert").filter({ hasText: "本机未找到 yt-dlp" }),
  ).toBeVisible();
  await expect(page.getByLabel("Caption Source 文件")).toBeVisible();
});

test("caption endpoint rejects unvalidated identifiers before invoking yt-dlp", async ({
  request,
}) => {
  const response = await request.post("/api/youtube/captions", {
    data: { videoId: "dQw4w9WgXcQ;unexpected-shell-input" },
  });

  expect(response.status()).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    error: "视频标识无效。",
  });
});

test("canceling slow caption extraction leaves no partial Study Video", async ({
  page,
}) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await page.goto("/");
  await page.getByRole("button", { name: "导入视频" }).click();
  await page
    .getByLabel("YouTube 视频链接")
    .fill("https://youtu.be/slowcap0001");
  await page.getByRole("button", { name: "开始导入" }).click();

  await expect(
    page.getByText("正在通过非官方 yt-dlp 获取英文字幕…"),
  ).toBeVisible();
  await page.getByRole("button", { name: "取消导入" }).click();
  await page.waitForTimeout(800);

  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("还没有学习视频")).toBeVisible();
  await expect(page.getByRole("button", { name: "导入视频" })).toBeEnabled();
});

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
  await expect(page.getByRole("progressbar", { name: "学习进度" })).toHaveAttribute(
    "value",
    "15",
  );
});

test("continuing a Study Video restores the current Learning Sentence without changing playback", async ({
  page,
}) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page, {
    contents: LONG_CAPTION_SOURCE,
    fileName: "long-interview.vtt",
  });

  const resumedSentence = page.locator(".learning-sentence").nth(19);
  await page.getByRole("button", { name: "播放第 20 句" }).click();
  await page.evaluate(() => Reflect.get(window, "__setYouTubeCurrentTime")(40));
  await expect(page.getByText("上次位置 0:40")).toBeVisible();
  await expect(resumedSentence).toHaveAttribute(
    "class",
    "learning-sentence active",
  );

  await page.getByRole("link", { name: "返回学习库" }).click();
  await page.evaluate(() =>
    Reflect.get(window, "__youtubePlayerCalls").splice(0),
  );
  await page.getByRole("link", { name: "继续学习" }).click();

  await expect(resumedSentence).toHaveAttribute(
    "class",
    "learning-sentence active",
  );
  await expect(resumedSentence).toBeInViewport();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "__youtubePlayerCalls")),
    )
    .toEqual([{ method: "seekTo", seconds: 40 }]);
});

test("player time keeps the current Learning Sentence aligned across gaps", async ({
  page,
}) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page, {
    contents: LONG_CAPTION_SOURCE,
    fileName: "long-interview.vtt",
  });

  const activeSentences = page.locator(".learning-sentence.active");
  const twentiethSentence = page.locator(".learning-sentence").nth(19);
  const twentyFirstSentence = page.locator(".learning-sentence").nth(20);
  await expect(page.getByRole("button", { name: "播放第 20 句" })).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() =>
        Reflect.get(window, "__setYouTubeCurrentTime")(39.25),
      ),
    )
    .toBe(true);
  await expect(twentiethSentence).toHaveAttribute(
    "class",
    "learning-sentence active",
  );

  await page.evaluate(() =>
    Reflect.get(window, "__setYouTubeCurrentTime")(40.75),
  );
  await expect(activeSentences).toHaveCount(0);

  await page.evaluate(() =>
    Reflect.get(window, "__setYouTubeCurrentTime")(41.25),
  );
  await expect(twentyFirstSentence).toHaveAttribute(
    "class",
    "learning-sentence active",
  );
  await expect(twentyFirstSentence).toBeInViewport();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "__youtubePlayerCalls")),
    )
    .toEqual([]);
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

test("Caption Source normalization keeps cue order, words, and explicit speakers", async ({
  page,
}) => {
  const markedUpOutOfOrderCaptionSource = `WEBVTT

00:00:06.000 --> 00:00:08.000
<v Maya><i>Second thought.</i></v>

00:00:01.000 --> 00:00:03.000 align:start position:10%
<c.highlight>First&nbsp;   thought.</c>
`;

  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page, {
    contents: markedUpOutOfOrderCaptionSource,
    fileName: "marked-up-out-of-order.vtt",
  });

  const learningSentences = page.locator(".learning-sentence strong");
  await expect(learningSentences).toHaveText([
    "First thought.",
    "Maya: Second thought.",
  ]);
});

test("rolling Caption Source text becomes one complete Learning Sentence", async ({
  page,
}) => {
  const rollingCaptionSource = `WEBVTT

00:00:01.000 --> 00:00:03.000
We are building

00:00:02.000 --> 00:00:04.500
building a better

00:00:04.000 --> 00:00:06.000
a better listening tool.
`;

  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page, {
    contents: rollingCaptionSource,
    fileName: "rolling.vtt",
  });

  await expect(
    page.getByText("We are building a better listening tool.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("1 句")).toBeVisible();

  await page.getByRole("button", { name: "播放第 1 句" }).click();
  await page.evaluate(() => Reflect.get(window, "__setYouTubeCurrentTime")(6));
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "__youtubePlayerCalls")),
    )
    .toEqual([
      { method: "seekTo", seconds: 1 },
      { method: "playVideo" },
      { method: "pauseVideo" },
    ]);
});

test("intentional repetition in adjacent full-length cues is preserved", async ({
  page,
}) => {
  const repeatedCaptionSource = `WEBVTT

00:00:01.000 --> 00:00:02.000
Go.

00:00:02.000 --> 00:00:03.000
Go.
`;

  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page, {
    contents: repeatedCaptionSource,
    fileName: "intentional-repetition.vtt",
  });

  await expect(page.locator(".learning-sentence strong")).toHaveText([
    "Go.",
    "Go.",
  ]);
  await expect(page.getByText("2 句")).toBeVisible();
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

  await installYouTubePlayerBoundary(page, { duration: 74 });
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

test("SRT display directives stay out of Learning Sentences", async ({ page }) => {
  const styledSrtCaptionSource = `1
00:00:01,000 --> 00:00:03,500
{\\an8}<font color="#fff">HOST:</font>   Welcome home.
`;

  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page, {
    contents: styledSrtCaptionSource,
    fileName: "styled-interview.srt",
    mimeType: "application/x-subrip",
  });

  await expect(page.getByText("HOST: Welcome home.", { exact: true })).toBeVisible();
  await expect(page.getByText(/\\an8/)).toHaveCount(0);
});

test("learner is given a supported URL example for an invalid URL", async ({
  page,
}) => {
  await submitStudyVideoImport(page, {
    uploadCaption: false,
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
  await submitStudyVideoImport(page, {
    uploadCaption: false,
    videoUrl: "not a url",
  });

  await expect(
    page.getByRole("alert").filter({ hasText: "请输入完整的 YouTube 视频链接" }),
  ).toBeVisible();
});

test("out-of-range timestamps are rejected", async ({ page }) => {
  const malformedTimestampSource = `WEBVTT

00:99:99.000 --> 02:00:00.000
This timestamp is not valid.
`;

  await installYouTubePlayerBoundary(page, { duration: 74 });
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

  await installYouTubePlayerBoundary(page, { duration: 74 });
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

  await installYouTubePlayerBoundary(page, { duration: 74 });
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
  await submitStudyVideoImport(page, { uploadCaption: false });

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
  await submitStudyVideoImport(page, { uploadCaption: false });

  await expect(
    page.getByRole("alert").filter({ hasText: "视频超过 3 小时" }),
  ).toBeVisible();
  await expect(page.getByText("还没有学习视频")).toBeVisible();
});

test("canceling a slow import leaves no partial Study Video", async ({ page }) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page, {
    uploadCaption: false,
    videoUrl: "https://youtu.be/slowvideo01",
  });

  await expect(page.getByText("正在读取视频信息…")).toBeVisible();
  await page.getByRole("button", { name: "取消导入" }).click();
  await page.waitForTimeout(1_800);

  await expect(page.getByText("还没有学习视频")).toBeVisible();
  await expect(page.getByRole("button", { name: "导入视频" })).toBeEnabled();
});
