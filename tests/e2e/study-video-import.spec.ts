import { readFile } from "node:fs/promises";

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
  options: {
    duration: number;
    errorCode?: number;
    playbackRates?: number[];
  },
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
      onPlaybackRateChange?: (event: { data: number }) => void;
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

      getAvailablePlaybackRates() {
        return fixture.playbackRates ?? [0.75, 1];
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

      setPlaybackRate(rate: number) {
        recordCall("setPlaybackRate", rate);
        this.playerOptions.events?.onPlaybackRateChange?.({ data: rate });
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
    rootUrl?: string;
    uploadCaption?: boolean;
    videoUrl?: string;
  } = {},
) {
  const uploadCaption = fixture.uploadCaption ?? true;
  await page.goto(fixture.rootUrl ?? "/");
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

async function selectTextWithinSentence(
  page: Page,
  sentenceIndex: number,
  selectedText: string,
) {
  await page
    .locator(".learning-sentence-text")
    .nth(sentenceIndex)
    .evaluate((element, requestedText) => {
      const document = element.ownerDocument;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const textNodes: Text[] = [];
      let fullText = "";
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        textNodes.push(node);
        fullText += node.data;
      }

      const startOffset = fullText.indexOf(requestedText);
      if (startOffset < 0) throw new Error(`Missing text: ${requestedText}`);
      const endOffset = startOffset + requestedText.length;
      let traversed = 0;
      let startNode: Text | null = null;
      let endNode: Text | null = null;
      let startInNode = 0;
      let endInNode = 0;

      for (const node of textNodes) {
        const nextTraversed = traversed + node.length;
        if (!startNode && startOffset <= nextTraversed) {
          startNode = node;
          startInNode = startOffset - traversed;
        }
        if (endOffset <= nextTraversed) {
          endNode = node;
          endInNode = endOffset - traversed;
          break;
        }
        traversed = nextTraversed;
      }
      if (!startNode || !endNode) throw new Error("Unable to create selection");

      const range = document.createRange();
      range.setStart(startNode, startInNode);
      range.setEnd(endNode, endInNode);
      const selection = document.defaultView?.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    }, selectedText);
}

async function selectAcrossSentences(page: Page) {
  await page.locator(".sentence-list").evaluate((list) => {
    const sentenceTexts = list.querySelectorAll(".learning-sentence-text");
    const firstText = sentenceTexts[0]?.firstChild;
    const secondText = sentenceTexts[1]?.lastChild;
    if (!firstText || !secondText) throw new Error("Missing sentence text");
    const range = document.createRange();
    range.setStart(firstText, 0);
    range.setEnd(secondText, secondText.textContent?.length ?? 0);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    sentenceTexts[1]?.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true }),
    );
  });
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
  await expect(page.locator(".learning-sentence-text")).toHaveText([
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

test("normal playback and sentence controls move naturally through the transcript", async ({
  page,
}) => {
  const threeSentenceCaptionSource = `WEBVTT

00:00:01.000 --> 00:00:03.500
Welcome to the show.

00:00:04.000 --> 00:00:07.000
Today we're talking about practice.

00:00:07.500 --> 00:00:10.000
Let's begin with listening.
`;

  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page, {
    contents: threeSentenceCaptionSource,
    fileName: "three-sentences.vtt",
  });

  const secondSentence = page.getByRole("button", { name: "播放第 2 句" });
  const thirdSentence = page.getByRole("button", { name: "播放第 3 句" });
  await secondSentence.click();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "__youtubePlayerCalls")),
    )
    .toEqual([
      { method: "seekTo", seconds: 4 },
      { method: "playVideo" },
    ]);

  await page.evaluate(() => Reflect.get(window, "__setYouTubeCurrentTime")(7.6));
  await expect(thirdSentence).toHaveAttribute(
    "class",
    "learning-sentence active",
  );
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "__youtubePlayerCalls")),
    )
    .toEqual([
      { method: "seekTo", seconds: 4 },
      { method: "playVideo" },
    ]);

  await page.getByRole("button", { name: /上一句/ }).click();
  await expect(secondSentence).toHaveAttribute(
    "class",
    "learning-sentence active",
  );
  await page.getByRole("button", { name: /下一句/ }).click();
  await expect(thirdSentence).toHaveAttribute(
    "class",
    "learning-sentence active",
  );
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "__youtubePlayerCalls")),
    )
    .toEqual([
      { method: "seekTo", seconds: 4 },
      { method: "playVideo" },
      { method: "seekTo", seconds: 4 },
      { method: "playVideo" },
      { method: "seekTo", seconds: 7.5 },
      { method: "playVideo" },
    ]);
});

test("repeat mode leaves an exact speaking gap and can resume natural playback", async ({
  page,
}) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page);

  const secondSentence = page.getByRole("button", { name: "播放第 2 句" });
  const repeatButton = page.getByRole("button", { name: /单句循环/ });
  await secondSentence.click();
  await repeatButton.click();
  await expect(repeatButton).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() =>
    Reflect.get(window, "__youtubePlayerCalls").splice(0),
  );

  await page.evaluate(() => Reflect.get(window, "__setYouTubeCurrentTime")(7));
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "__youtubePlayerCalls")),
    )
    .toEqual([{ method: "pauseVideo" }]);
  await expect(page.getByText("3 秒跟读空档")).toBeVisible();
  await expect(secondSentence).toHaveAttribute(
    "class",
    "learning-sentence active",
  );

  await page.waitForTimeout(2_700);
  await expect(
    page.evaluate(() => Reflect.get(window, "__youtubePlayerCalls")),
  ).resolves.toEqual([{ method: "pauseVideo" }]);
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "__youtubePlayerCalls")),
    )
    .toEqual([
      { method: "pauseVideo" },
      { method: "seekTo", seconds: 4 },
      { method: "playVideo" },
    ]);

  await page.evaluate(() => Reflect.get(window, "__setYouTubeCurrentTime")(7));
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "__youtubePlayerCalls").length),
    )
    .toBe(4);
  await repeatButton.click();
  await expect(repeatButton).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "__youtubePlayerCalls")),
    )
    .toEqual([
      { method: "pauseVideo" },
      { method: "seekTo", seconds: 4 },
      { method: "playVideo" },
      { method: "pauseVideo" },
      { method: "playVideo" },
    ]);
  await page.waitForTimeout(500);
  await expect(page.getByText("3 秒跟读空档")).toHaveCount(0);
});

test("transcript visibility and playback speed respect learner and video capabilities", async ({
  page,
}) => {
  await installYouTubePlayerBoundary(page, {
    duration: 74,
    playbackRates: [0.75, 1, 1.25],
  });
  await page.goto("/");
  await page.getByRole("button", { name: "设置与诊断" }).click();
  await page.getByRole("checkbox", { name: "默认隐藏字幕" }).check();
  await expect(page.getByText("偏好已保存")).toBeVisible();
  await page.getByRole("button", { name: "关闭设置与诊断" }).click();
  await submitStudyVideoImport(page);
  await expect(
    page.getByRole("heading", { name: "The Daily American Interview" }),
  ).toBeVisible();

  const firstSentenceText = page.locator(".learning-sentence-text").first();
  await expect(firstSentenceText).toBeHidden();
  await expect(page.getByRole("button", { name: "0.75x" })).toBeVisible();
  await expect(page.getByRole("button", { name: "1x" })).toBeVisible();
  await expect(page.getByRole("button", { name: "1.25x" })).toHaveCount(0);
  await expect(
    page.getByText(/YouTube 原生字幕默认关闭.*播放器内 CC/),
  ).toBeVisible();

  await page.getByRole("button", { name: /显示原文/ }).click();
  await expect(firstSentenceText).toBeVisible();
  await page.evaluate(() =>
    Reflect.get(window, "__youtubePlayerCalls").splice(0),
  );
  await page.getByRole("button", { name: "0.75x" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "__youtubePlayerCalls")),
    )
    .toEqual([{ method: "setPlaybackRate", seconds: 0.75 }]);
  await expect(page.getByRole("button", { name: "0.75x" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("Chinese shortcut guide matches the available listening controls", async ({
  page,
}) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page);

  await expect(page.getByText(/快捷键.*Alt.*R.*T/)).toBeVisible();
  await page.getByRole("button", { name: "播放第 2 句" }).click();
  await page.evaluate(() =>
    Reflect.get(window, "__youtubePlayerCalls").splice(0),
  );

  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.getByRole("button", { name: "播放第 1 句" })).toHaveAttribute(
    "class",
    "learning-sentence active",
  );
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByRole("button", { name: "播放第 2 句" })).toHaveAttribute(
    "class",
    "learning-sentence active",
  );
  await page.keyboard.press("r");
  await expect(page.getByRole("button", { name: /单句循环/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("t");
  await expect(page.locator(".learning-sentence-text").first()).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "__youtubePlayerCalls")),
    )
    .toEqual([
      { method: "seekTo", seconds: 1 },
      { method: "playVideo" },
      { method: "seekTo", seconds: 4 },
      { method: "playVideo" },
    ]);
});

test("a Local Revision validates, persists, drives playback, and restores one sentence", async ({
  page,
}) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page);

  await page.getByRole("button", { name: "编辑第 2 句" }).click();
  const editor = page.getByRole("region", { name: "编辑第 2 句" });
  await editor.getByLabel("开始时间（秒）").fill("7");
  await editor.getByLabel("结束时间（秒）").fill("6");
  await editor.getByRole("button", { name: "保存修订" }).click();
  await expect(editor.getByRole("alert")).toContainText("结束时间必须晚于开始时间");

  await editor.getByLabel("句子文本").fill("Today we practice careful listening.");
  await editor.getByLabel("开始时间（秒）").fill("4.5");
  await editor.getByLabel("结束时间（秒）").fill("6.5");
  await editor.getByRole("button", { name: "保存修订" }).click();

  await expect(
    page.getByText("Today we practice careful listening.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Local Revision", { exact: true })).toBeVisible();
  const persistedLayers = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open("learn-my-english");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stored = await new Promise<unknown[]>((resolve, reject) => {
      const request = database
        .transaction("study-videos", "readonly")
        .objectStore("study-videos")
        .getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    const studyVideo = stored[0] as {
      captionSource: { cues: Array<{ text: string }> };
      learningSentences: Array<{ text: string }>;
      localRevision: { sentences: Array<{ text: string }> };
    };
    return {
      captionSourceText: studyVideo.captionSource.cues[1].text,
      originalLearningSentence: studyVideo.learningSentences[1].text,
      revisedLearningSentence: studyVideo.localRevision.sentences[1].text,
    };
  });
  expect(persistedLayers).toEqual({
    captionSourceText: "Today we're talking about practice.",
    originalLearningSentence: "Today we're talking about practice.",
    revisedLearningSentence: "Today we practice careful listening.",
  });
  await page.evaluate(() =>
    Reflect.get(window, "__youtubePlayerCalls").splice(0),
  );
  await page.getByRole("button", { name: "播放第 2 句" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "__youtubePlayerCalls")),
    )
    .toEqual([
      { method: "seekTo", seconds: 4.5 },
      { method: "playVideo" },
    ]);

  await page.reload();
  await expect(
    page.getByText("Today we practice careful listening.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "播放第 2 句" }).click();
  const revisedRepeatButton = page.getByRole("button", { name: /单句循环/ });
  await revisedRepeatButton.click();
  await page.evaluate(() =>
    Reflect.get(window, "__youtubePlayerCalls").splice(0),
  );
  await page.evaluate(() => Reflect.get(window, "__setYouTubeCurrentTime")(6.5));
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "__youtubePlayerCalls")),
    )
    .toEqual([{ method: "pauseVideo" }]);
  await revisedRepeatButton.click();
  await page.getByRole("button", { name: "编辑第 2 句" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "恢复这一句" }).click();

  await expect(
    page.getByText("Today we're talking about practice.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Local Revision", { exact: true })).toHaveCount(0);
  await page.evaluate(() =>
    Reflect.get(window, "__youtubePlayerCalls").splice(0),
  );
  await page.getByRole("button", { name: "播放第 2 句" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "__youtubePlayerCalls")),
    )
    .toEqual([
      { method: "seekTo", seconds: 4 },
      { method: "playVideo" },
    ]);
});

test("the learner can split, merge, and restore all original Learning Sentences", async ({
  page,
}) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page);

  await page.getByRole("button", { name: "编辑第 1 句" }).click();
  const firstEditor = page.getByRole("region", { name: "编辑第 1 句" });
  await firstEditor.getByLabel("拆分位置").selectOption({ index: 1 });
  await firstEditor.getByRole("button", { name: "拆分句子" }).click();
  await expect(page.getByText("3 句", { exact: true })).toBeVisible();
  await expect(page.getByText("Local Revision", { exact: true })).toHaveCount(2);

  await page.getByRole("button", { name: "编辑第 2 句" }).click();
  const secondEditor = page.getByRole("region", { name: "编辑第 2 句" });
  await expect(
    secondEditor.getByRole("button", { name: "与上一句合并" }),
  ).toBeEnabled();
  await expect(
    secondEditor.getByRole("button", { name: "与下一句合并" }),
  ).toBeEnabled();
  await secondEditor.getByLabel("句子文本").fill("to our show.");
  await secondEditor.getByRole("button", { name: "保存修订" }).click();

  await page.getByRole("button", { name: "编辑第 1 句" }).click();
  await page
    .getByRole("region", { name: "编辑第 1 句" })
    .getByRole("button", { name: "与下一句合并" })
    .click();
  await expect(page.getByText("2 句", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Welcome to our show.", { exact: true }),
  ).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "恢复整个 Study Video 的原始结果" })
    .click();
  await expect(
    page.getByText("Welcome to the show.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Today we're talking about practice.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Local Revision", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("学习者提供的 Caption Source · VTT", { exact: true }),
  ).toBeVisible();
});

test("clicking a word pauses playback and opens a cached Dictionary lookup", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:4174/reset");
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page);
  await page.evaluate(() =>
    Reflect.get(window, "__youtubePlayerCalls").splice(0),
  );

  await page.getByRole("button", { name: "查询 practice" }).click();
  const lookup = page.getByRole("complementary", {
    name: "Word Lookup: practice",
  });
  await expect(lookup).toBeVisible();
  await expect(lookup.getByText("Dictionary facts", { exact: true })).toBeVisible();
  const dictionaryFacts = lookup.getByRole("region", {
    name: "基础词典事实 practice",
  });
  await expect(lookup.getByText("原文词形 practice", { exact: true })).toBeVisible();
  await expect(lookup.getByText("词典形式 practice", { exact: true })).toBeVisible();
  await expect(dictionaryFacts.getByText("noun", { exact: true })).toBeVisible();
  await expect(
    dictionaryFacts.getByText("/ˈpræk.tɪs/", { exact: true }),
  ).toBeVisible();
  await expect(
    dictionaryFacts.getByText(
      "Repetition of an activity to improve a skill.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    dictionaryFacts.getByText("Careful listening improves with practice.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(lookup.getByText("已确认的美式词典音频")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "__youtubePlayerCalls")),
    )
    .toEqual([{ method: "pauseVideo" }]);

  const playerBox = await page
    .getByRole("region", { name: "YouTube 播放器" })
    .boundingBox();
  const lookupBox = await lookup.boundingBox();
  expect(lookupBox?.x).toBeGreaterThanOrEqual(
    (playerBox?.x ?? 0) + (playerBox?.width ?? 0),
  );

  await lookup.getByRole("button", { name: "关闭 Word Lookup" }).click();
  await expect(lookup).toHaveCount(0);
  await expect(
    page.evaluate(() => Reflect.get(window, "__youtubePlayerCalls")),
  ).resolves.toEqual([{ method: "pauseVideo" }]);

  await page.getByRole("button", { name: "查询 practice" }).click();
  await expect(
    page.getByRole("complementary", { name: "Word Lookup: practice" })
      .getByText("本地缓存", { exact: true }),
  ).toBeVisible();
  const providerRequests = await request
    .get("http://127.0.0.1:4174/requests?term=practice")
    .then((response) => response.json());
  expect(providerRequests).toEqual({ count: 1 });
});

test("inflections, contractions, candidate expressions, and phrase selection are transparent", async ({
  page,
}) => {
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page);

  await page.getByRole("button", { name: "查询 talking" }).click();
  let lookup = page.getByRole("complementary", {
    name: "Word Lookup: talking",
  });
  await expect(lookup.getByText("原文词形 talking", { exact: true })).toBeVisible();
  await expect(lookup.getByText("词典形式 talk", { exact: true })).toBeVisible();
  await lookup.getByRole("button", { name: "查询候选短语 talk about" }).click();
  await expect(lookup.getByText("原文词形 talking about", { exact: true })).toBeVisible();
  await expect(lookup.getByText("词典形式 talk about", { exact: true })).toBeVisible();
  await expect(lookup.getByText("To discuss a particular subject.")).toBeVisible();
  await lookup.getByRole("button", { name: "关闭 Word Lookup" }).click();

  await page.getByRole("button", { name: "查询 we're" }).click();
  lookup = page.getByRole("complementary", { name: "Word Lookup: we're" });
  await expect(lookup.getByText("原文词形 we're", { exact: true })).toBeVisible();
  await expect(lookup.getByText("词典形式 we are", { exact: true })).toBeVisible();
  await expect(lookup.getByText("基础词典没有收录这个词条")).toBeVisible();
  await lookup.getByRole("button", { name: "关闭 Word Lookup" }).click();

  await selectTextWithinSentence(page, 1, "talking about practice");
  lookup = page.getByRole("complementary", {
    name: "Word Lookup: talking about practice",
  });
  await expect(lookup.getByText("词典形式 talk about practice")).toBeVisible();
  await expect(
    lookup.getByText(
      "To discuss the repeated work used to improve a skill.",
    ),
  ).toBeVisible();
  await lookup.getByRole("button", { name: "关闭 Word Lookup" }).click();

  await selectAcrossSentences(page);
  await expect(
    page.getByRole("alert").filter({
      hasText: "只能查询同一句 Learning Sentence 中的连续文本",
    }),
  ).toBeVisible();
  await expect(page.getByRole("complementary")).toHaveCount(0);
});

test("missing audio uses en-US speech and dictionary failures stay explicit", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const speechCalls: Array<{ lang: string; text: string }> = [];
    class FakeSpeechSynthesisUtterance {
      lang = "";
      text: string;
      constructor(text: string) {
        this.text = text;
      }
    }
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      value: FakeSpeechSynthesisUtterance,
    });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        cancel: () => undefined,
        speak: (utterance: { lang: string; text: string }) =>
          speechCalls.push({ lang: utterance.lang, text: utterance.text }),
      },
    });
    Reflect.set(window, "__speechCalls", speechCalls);
  });
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page, {
    contents: `WEBVTT

00:00:01.000 --> 00:00:04.000
Mystery failure arrives.
`,
  });

  await page.getByRole("button", { name: "查询 Mystery" }).click();
  let lookup = page.getByRole("complementary", {
    name: "Word Lookup: Mystery",
  });
  await expect(lookup.getByText("基础词典没有收录这个词条")).toBeVisible();
  await lookup.getByRole("button", { name: "关闭 Word Lookup" }).click();

  await page.getByRole("button", { name: "查询 failure" }).click();
  lookup = page.getByRole("complementary", {
    name: "Word Lookup: failure",
  });
  await expect(lookup.getByRole("alert")).toContainText(
    "基础词典暂时不可用，也没有可用缓存",
  );
  await lookup.getByRole("button", { name: "关闭 Word Lookup" }).click();

  await page.getByRole("button", { name: "编辑第 1 句" }).click();
  const editor = page.getByRole("region", { name: "编辑第 1 句" });
  await editor.getByLabel("句子文本").fill("We are talking clearly.");
  await editor.getByRole("button", { name: "保存修订" }).click();
  await page.getByRole("button", { name: "查询 talking" }).click();
  lookup = page.getByRole("complementary", {
    name: "Word Lookup: talking",
  });
  const browserPronunciation = lookup.getByRole("button", {
    name: "使用浏览器美式发音朗读 talk",
  });
  await expect(browserPronunciation).toBeVisible();
  await browserPronunciation.click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__speechCalls")))
    .toEqual([{ lang: "en-US", text: "talk" }]);
});

test("local AI selects a supplied dictionary sense without blurring source boundaries", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:4174/reset");
  await request.post("http://127.0.0.1:4176/reset");
  await request.post("http://127.0.0.1:4177/reset");
  let browserAiResponse = "";
  page.on("response", async (response) => {
    if (response.url().endsWith("/api/word-lookup/ai")) {
      browserAiResponse = await response.text();
    }
  });
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page);

  await page.getByRole("button", { name: "查询 practice" }).click();
  const lookup = page.getByRole("complementary", {
    name: "Word Lookup: practice",
  });
  await expect(lookup.getByText("Local AI", { exact: true })).toBeVisible();

  const dictionaryFacts = lookup.getByRole("region", {
    name: "基础词典事实 practice",
  });
  await expect(
    dictionaryFacts.getByText(
      "Repetition of an activity to improve a skill.",
      { exact: true },
    ),
  ).toBeVisible();

  const aiAssistance = lookup.getByRole("region", {
    name: "Local AI 辅助",
  });
  await expect(
    aiAssistance.getByText("AI 生成例句，不是词典原文", { exact: true }),
  ).toBeVisible();
  await expect(
    aiAssistance.getByText(
      "Repetition of an activity to improve a skill.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    aiAssistance.getByText(
      "She improves her pronunciation through daily practice.",
      { exact: true },
    ),
  ).toBeVisible();

  const providerRequests = await request
    .get("http://127.0.0.1:4176/requests")
    .then((response) => response.json());
  expect(providerRequests.items).toHaveLength(1);
  const providerRequest = providerRequests.items[0];
  expect(providerRequest.authorization).toBe("Bearer e2e-local-secret");
  expect(providerRequest.body.model).toBe("e2e-local-model");
  expect(providerRequest.body.response_format).toMatchObject({
    type: "json_schema",
    json_schema: { strict: true },
  });
  expect(providerRequest.body.messages).toHaveLength(2);
  const untrustedPayload = JSON.parse(
    providerRequest.body.messages[1].content.replace(
      "UNTRUSTED_LOOKUP_DATA=",
      "",
    ),
  );
  expect(untrustedPayload).toEqual({
    task: "enrich",
    expression: "practice",
    sentence: "Today we're talking about practice.",
    senses: [
      {
        definition: "Repetition of an activity to improve a skill.",
        id: "0:0:0",
        partOfSpeech: "noun",
      },
    ],
  });
  expect(JSON.stringify(providerRequest.body)).not.toContain(
    "Welcome to the show.",
  );
  await expect.poll(() => browserAiResponse).not.toContain("e2e-local-secret");

  const persistedLookupData = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const openRequest = indexedDB.open("learn-my-english", 4);
      openRequest.onsuccess = () => resolve(openRequest.result);
      openRequest.onerror = () => reject(openRequest.error);
    });
    const values = await new Promise<unknown[]>((resolve, reject) => {
      const readRequest = database
        .transaction("word-lookups", "readonly")
        .objectStore("word-lookups")
        .getAll();
      readRequest.onsuccess = () => resolve(readRequest.result);
      readRequest.onerror = () => reject(readRequest.error);
    });
    database.close();
    return JSON.stringify(values);
  });
  expect(persistedLookupData).not.toContain("e2e-local-secret");
  const deepSeekRequests = await request
    .get("http://127.0.0.1:4177/requests")
    .then((response) => response.json());
  expect(deepSeekRequests.items).toHaveLength(0);
});

test("first DeepSeek fallback explains cloud data and remembers a refusal", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:4176/reset");
  await request.post("http://127.0.0.1:4177/reset");
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page);

  await page.getByRole("button", { name: "查询 talking" }).click();
  let lookup = page.getByRole("complementary", {
    name: "Word Lookup: talking",
  });
  await expect(
    lookup.getByRole("heading", { name: "允许使用 DeepSeek 云端回退？" }),
  ).toBeVisible();
  await expect(lookup.getByText("所选单词或短语", { exact: false })).toBeVisible();
  await expect(lookup.getByText("当前 Learning Sentence", { exact: false })).toBeVisible();
  await expect(lookup.getByText("基础词典候选义项", { exact: false })).toBeVisible();

  let deepSeekRequests = await request
    .get("http://127.0.0.1:4177/requests")
    .then((response) => response.json());
  expect(deepSeekRequests.items).toHaveLength(0);

  await lookup
    .getByRole("button", { name: "拒绝，仅使用基础词典" })
    .click();
  await expect(lookup.getByText("Dictionary only", { exact: true })).toBeVisible();
  await expect(lookup.getByText("已拒绝向 DeepSeek 发送内容")).toBeVisible();
  await expect(
    lookup.getByText("To communicate, usually by means of speech."),
  ).toBeVisible();

  await lookup.getByRole("button", { name: "关闭 Word Lookup" }).click();
  await page.reload();
  await page.getByRole("button", { name: "查询 talking" }).click();
  lookup = page.getByRole("complementary", { name: "Word Lookup: talking" });
  await expect(
    lookup.getByRole("heading", { name: "允许使用 DeepSeek 云端回退？" }),
  ).toHaveCount(0);
  await expect(lookup.getByText("已拒绝向 DeepSeek 发送内容")).toBeVisible();
  deepSeekRequests = await request
    .get("http://127.0.0.1:4177/requests")
    .then((response) => response.json());
  expect(deepSeekRequests.items).toHaveLength(0);
});

test("consented DeepSeek fallback is minimal, remembered, and follows Local AI", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:4176/reset");
  await request.post("http://127.0.0.1:4177/reset");
  let browserAiResponse = "";
  page.on("response", async (response) => {
    if (response.url().endsWith("/api/word-lookup/ai")) {
      browserAiResponse += await response.text();
    }
  });
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page);

  await page.getByRole("button", { name: "查询 talking" }).click();
  let lookup = page.getByRole("complementary", {
    name: "Word Lookup: talking",
  });
  await lookup.getByRole("button", { name: "同意并使用 DeepSeek" }).click();
  await expect(lookup.getByText("DeepSeek", { exact: true })).toBeVisible();
  await expect(
    lookup.getByText(
      "They talk every morning before the interview begins.",
      { exact: true },
    ),
  ).toBeVisible();

  let localRequests = await request
    .get("http://127.0.0.1:4176/requests")
    .then((response) => response.json());
  let deepSeekRequests = await request
    .get("http://127.0.0.1:4177/requests")
    .then((response) => response.json());
  expect(
    localRequests.items.filter(
      (item: { expression: string }) => item.expression === "talk",
    ),
  ).toHaveLength(2);
  expect(deepSeekRequests.items).toHaveLength(1);
  const cloudRequest = deepSeekRequests.items[0];
  expect(cloudRequest.authorization).toBe("Bearer e2e-deepseek-secret");
  expect(cloudRequest.body.model).toBe("e2e-deepseek-model");
  expect(cloudRequest.body.response_format).toEqual({ type: "json_object" });
  expect(cloudRequest.body.messages).toHaveLength(2);
  const untrustedPayload = JSON.parse(
    cloudRequest.body.messages[1].content.replace(
      "UNTRUSTED_LOOKUP_DATA=",
      "",
    ),
  );
  expect(untrustedPayload).toEqual({
    task: "enrich",
    expression: "talk",
    sentence: "Today we're talking about practice.",
    senses: [
      {
        definition: "To communicate, usually by means of speech.",
        id: "0:0:0",
        partOfSpeech: "verb",
      },
    ],
  });
  expect(JSON.stringify(cloudRequest.body)).not.toContain("Welcome to the show.");
  expect(browserAiResponse).not.toContain("e2e-deepseek-secret");
  const persistedBrowserData = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const openRequest = indexedDB.open("learn-my-english", 4);
      openRequest.onsuccess = () => resolve(openRequest.result);
      openRequest.onerror = () => reject(openRequest.error);
    });
    const storeNames = ["preferences", "word-lookups"];
    const storedValues = await Promise.all(
      storeNames.map(
        (storeName) =>
          new Promise<unknown[]>((resolve, reject) => {
            const readRequest = database
              .transaction(storeName, "readonly")
              .objectStore(storeName)
              .getAll();
            readRequest.onsuccess = () => resolve(readRequest.result);
            readRequest.onerror = () => reject(readRequest.error);
          }),
      ),
    );
    database.close();
    return JSON.stringify(storedValues);
  });
  expect(persistedBrowserData).not.toContain("e2e-deepseek-secret");

  await lookup.getByRole("button", { name: "关闭 Word Lookup" }).click();
  await page.getByRole("button", { name: "查询 talking" }).click();
  lookup = page.getByRole("complementary", { name: "Word Lookup: talking" });
  await expect(
    lookup.getByRole("heading", { name: "允许使用 DeepSeek 云端回退？" }),
  ).toHaveCount(0);
  await expect(lookup.getByText("DeepSeek", { exact: true })).toBeVisible();
  localRequests = await request
    .get("http://127.0.0.1:4176/requests")
    .then((response) => response.json());
  deepSeekRequests = await request
    .get("http://127.0.0.1:4177/requests")
    .then((response) => response.json());
  expect(
    localRequests.items.filter(
      (item: { expression: string }) => item.expression === "talk",
    ),
  ).toHaveLength(3);
  expect(deepSeekRequests.items).toHaveLength(2);
});

test("DeepSeek consent can be inspected and revoked from settings", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:4176/reset");
  await request.post("http://127.0.0.1:4177/reset");
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page);
  await page.waitForURL(/\/study\//);
  const studyUrl = page.url();

  await page.getByRole("button", { name: "查询 talking" }).click();
  let lookup = page.getByRole("complementary", {
    name: "Word Lookup: talking",
  });
  await lookup.getByRole("button", { name: "同意并使用 DeepSeek" }).click();
  await expect(lookup.getByText("DeepSeek", { exact: true })).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: "设置与诊断" }).click();
  await expect(page.getByText("已允许 DeepSeek 云端回退")).toBeVisible();
  await page
    .getByRole("button", { name: "撤销 DeepSeek 云端许可" })
    .click();
  await expect(page.getByText("尚未决定是否使用 DeepSeek 云端回退")).toBeVisible();

  const beforeReopen = await request
    .get("http://127.0.0.1:4177/requests")
    .then((response) => response.json());
  await page.goto(studyUrl);
  await page.getByRole("button", { name: "查询 talking" }).click();
  lookup = page.getByRole("complementary", { name: "Word Lookup: talking" });
  await expect(
    lookup.getByRole("heading", { name: "允许使用 DeepSeek 云端回退？" }),
  ).toBeVisible();
  const afterReopen = await request
    .get("http://127.0.0.1:4177/requests")
    .then((response) => response.json());
  expect(afterReopen.items).toHaveLength(beforeReopen.items.length);
});

test("DeepSeek invalid output, provider failure, and timeout preserve dictionary facts", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:4176/reset");
  await request.post("http://127.0.0.1:4177/reset");
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page);

  await page.getByRole("button", { name: "查询 talking" }).click();
  let lookup = page.getByRole("complementary", {
    name: "Word Lookup: talking",
  });
  await lookup.getByRole("button", { name: "同意并使用 DeepSeek" }).click();
  await expect(lookup.getByText("DeepSeek", { exact: true })).toBeVisible();
  await lookup.getByRole("checkbox", { name: "显示中文释义" }).check();
  await expect(lookup.getByText("DeepSeek 返回格式无效")).toBeVisible();
  await expect(
    lookup
      .getByRole("region", { name: "基础词典事实 talk" })
      .getByText("To communicate, usually by means of speech."),
  ).toBeVisible();

  await lookup.getByRole("button", { name: "查询候选短语 talk about" }).click();
  await expect(lookup.getByText("Dictionary only", { exact: true })).toBeVisible();
  await expect(lookup.getByText("DeepSeek 暂时不可用")).toBeVisible();
  await expect(lookup.getByText("To discuss a particular subject.")).toBeVisible();
  await lookup.getByRole("button", { name: "关闭 Word Lookup" }).click();

  await selectTextWithinSentence(page, 1, "talking about practice");
  lookup = page.getByRole("complementary", {
    name: "Word Lookup: talking about practice",
  });
  await expect(lookup.getByText("Dictionary only", { exact: true })).toBeVisible();
  await expect(lookup.getByText("DeepSeek 响应超时")).toBeVisible();
  await expect(
    lookup.getByText(
      "To discuss the repeated work used to improve a skill.",
    ),
  ).toBeVisible();
});

test("Chinese meaning is default-off, lazy, and cached separately", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:4176/reset");
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page, { rootUrl: "http://127.0.0.1:3104/" });

  await page.getByRole("button", { name: "查询 practice" }).click();
  let lookup = page.getByRole("complementary", {
    name: "Word Lookup: practice",
  });
  await expect(lookup.getByText("Local AI", { exact: true })).toBeVisible();
  let chineseToggle = lookup.getByRole("checkbox", {
    name: "显示中文释义",
  });
  await expect(chineseToggle).not.toBeChecked();
  await expect(lookup.getByText("练习；实践", { exact: true })).toHaveCount(0);

  let providerRequests = await request
    .get("http://127.0.0.1:4176/requests")
    .then((response) => response.json());
  expect(providerRequests.items.map((item: { task: string }) => item.task)).toEqual([
    "enrich",
  ]);

  await chineseToggle.check();
  await expect(lookup.getByText("练习；实践", { exact: true })).toBeVisible();
  providerRequests = await request
    .get("http://127.0.0.1:4176/requests")
    .then((response) => response.json());
  expect(providerRequests.items.map((item: { task: string }) => item.task)).toEqual([
    "enrich",
    "translate",
  ]);

  await lookup.getByRole("button", { name: "关闭 Word Lookup" }).click();
  await page.getByRole("button", { name: "查询 practice" }).click();
  lookup = page.getByRole("complementary", { name: "Word Lookup: practice" });
  await expect(lookup.getByText("Local AI", { exact: true })).toBeVisible();
  chineseToggle = lookup.getByRole("checkbox", { name: "显示中文释义" });
  await expect(chineseToggle).not.toBeChecked();
  await expect(lookup.getByText("练习；实践", { exact: true })).toHaveCount(0);
  await chineseToggle.check();
  await expect(lookup.getByText("练习；实践", { exact: true })).toBeVisible();

  providerRequests = await request
    .get("http://127.0.0.1:4176/requests")
    .then((response) => response.json());
  expect(providerRequests.items).toHaveLength(2);
});

test("invalid output, provider failure, and timeout preserve Dictionary-only output", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:4176/reset");
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page, { rootUrl: "http://127.0.0.1:3104/" });

  await page.getByRole("button", { name: "查询 talking" }).click();
  let lookup = page.getByRole("complementary", {
    name: "Word Lookup: talking",
  });
  await expect(lookup.getByText("Dictionary only", { exact: true })).toBeVisible();
  await expect(
    lookup.getByText("本地 AI 返回格式无效，已保留基础词典结果"),
  ).toBeVisible();
  await expect(
    lookup.getByText("To communicate, usually by means of speech."),
  ).toBeVisible();
  await lookup.getByRole("button", { name: "关闭 Word Lookup" }).click();

  await page.getByRole("button", { name: "查询 talking" }).click();
  lookup = page.getByRole("complementary", { name: "Word Lookup: talking" });
  await expect(
    lookup.getByText("本地 AI 返回格式无效，已保留基础词典结果"),
  ).toBeVisible();
  let providerRequests = await request
    .get("http://127.0.0.1:4176/requests")
    .then((response) => response.json());
  expect(
    providerRequests.items.filter(
      (item: { expression: string }) => item.expression === "talk",
    ),
  ).toHaveLength(2);

  await lookup.getByRole("button", { name: "查询候选短语 talk about" }).click();
  await expect(
    lookup.getByText("本地 AI 暂时不可用，已保留基础词典结果"),
  ).toBeVisible();
  await expect(lookup.getByText("To discuss a particular subject.")).toBeVisible();
  await lookup.getByRole("button", { name: "关闭 Word Lookup" }).click();

  await selectTextWithinSentence(page, 1, "talking about practice");
  lookup = page.getByRole("complementary", {
    name: "Word Lookup: talking about practice",
  });
  await expect(
    lookup.getByText("本地 AI 响应超时，已保留基础词典结果"),
  ).toBeVisible();
  await expect(
    lookup.getByText(
      "To discuss the repeated work used to improve a skill.",
    ),
  ).toBeVisible();
});

test("missing local AI configuration leaves Word Lookup usable", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:4176/reset");
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page, { rootUrl: "http://127.0.0.1:3101/" });

  await page.getByRole("button", { name: "查询 practice" }).click();
  const lookup = page.getByRole("complementary", {
    name: "Word Lookup: practice",
  });
  await expect(lookup.getByText("Dictionary only", { exact: true })).toBeVisible();
  await expect(
    lookup.getByText("本地 AI 未配置，当前使用基础词典"),
  ).toBeVisible();
  await expect(
    lookup.getByText("Repetition of an activity to improve a skill."),
  ).toBeVisible();

  const providerRequests = await request
    .get("http://127.0.0.1:4176/requests")
    .then((response) => response.json());
  expect(providerRequests.items).toHaveLength(0);
});

test("Word Bank preserves contextual lookups, distinct videos, and exact sentence return", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:4174/reset");
  await request.post("http://127.0.0.1:4176/reset");
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page);

  await page.getByRole("button", { name: "查询 practice" }).click();
  let lookup = page.getByRole("complementary", {
    name: "Word Lookup: practice",
  });
  await expect(lookup.getByText("Local AI", { exact: true })).toBeVisible();
  await lookup.getByRole("checkbox", { name: "显示中文释义" }).check();
  await expect(lookup.getByText("练习；实践", { exact: true })).toBeVisible();

  const saveButton = lookup.getByRole("button", { name: "保存到 Word Bank" });
  await saveButton.click();
  await expect(lookup.getByText("已保存到 Word Bank")).toBeVisible();
  await lookup.getByRole("button", { name: "取消保存" }).click();
  await expect(saveButton).toBeVisible();
  await saveButton.click();
  await expect(lookup.getByText("已保存到 Word Bank")).toBeVisible();

  await page.route("**/api/dictionary**", (route) => route.abort());
  await page.route("**/api/word-lookup/ai", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Word Bank" })).toBeVisible();
  let bankEntries = page.getByRole("article", { name: /Word Bank: practice/ });
  await expect(bankEntries).toHaveCount(1);
  let firstEntry = bankEntries.filter({
    hasText: "Today we're talking about practice.",
  });
  await expect(firstEntry).toContainText(
    "Repetition of an activity to improve a skill.",
  );
  await expect(firstEntry).toContainText("Today we're talking about practice.");
  await expect(firstEntry).toContainText("0:04–0:07");
  await expect(
    firstEntry.getByLabel("Word Bank 美式发音 practice"),
  ).toHaveAttribute(
    "src",
    "https://api.dictionaryapi.dev/media/pronunciations/en/practice-us.mp3",
  );
  let bankChineseToggle = firstEntry.getByRole("checkbox", {
    name: "显示 practice 的中文释义",
  });
  await expect(bankChineseToggle).not.toBeChecked();
  await expect(firstEntry.getByText("练习；实践", { exact: true })).toHaveCount(0);
  await bankChineseToggle.check();
  await expect(firstEntry.getByText("练习；实践", { exact: true })).toBeVisible();

  await page.reload();
  bankEntries = page.getByRole("article", { name: /Word Bank: practice/ });
  firstEntry = bankEntries.filter({
    hasText: "Today we're talking about practice.",
  });
  await expect(firstEntry).toBeVisible();
  await firstEntry.getByRole("link", { name: "回到原句并播放" }).click();
  await expect(page.getByText("已从 Word Bank 返回并播放第 2 句")).toBeVisible();
  await expect(page.getByRole("button", { name: "播放第 2 句" })).toHaveClass(
    /active/,
  );
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "__youtubePlayerCalls")),
    )
    .toEqual(
      expect.arrayContaining([
        { method: "seekTo", seconds: 4 },
        { method: "playVideo" },
      ]),
    );

  await page.unroute("**/api/dictionary**");
  await page.unroute("**/api/word-lookup/ai");
  await submitStudyVideoImport(page, {
    uploadCaption: false,
    videoUrl: "https://youtu.be/autocaps001",
  });
  await page.getByRole("button", { name: "查询 Practice" }).click();
  lookup = page.getByRole("complementary", { name: "Word Lookup: Practice" });
  await expect(lookup.getByText("Local AI", { exact: true })).toBeVisible();
  await lookup.getByRole("button", { name: "保存到 Word Bank" }).click();
  await expect(lookup.getByText("已保存到 Word Bank")).toBeVisible();

  await page.goto("/");
  bankEntries = page.getByRole("article", { name: /Word Bank: practice/i });
  await expect(bankEntries).toHaveCount(2);
  await expect(
    bankEntries.filter({ hasText: "Today we're talking about practice." }),
  ).toBeVisible();
  const secondEntry = bankEntries.filter({
    hasText: "Practice with automatic captions.",
  });
  await expect(secondEntry).toBeVisible();
  await secondEntry
    .getByRole("button", { name: "从 Word Bank 移除 practice" })
    .click();
  await expect(bankEntries).toHaveCount(1);
  await page.reload();
  await expect(
    page.getByRole("article", { name: /Word Bank: practice/i }),
  ).toHaveCount(1);
});

test("Study Video deletion keeps or atomically removes only its Word Bank contexts", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:4174/reset");
  await request.post("http://127.0.0.1:4176/reset");
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page);

  await page.getByRole("button", { name: "查询 practice" }).click();
  let lookup = page.getByRole("complementary", {
    name: "Word Lookup: practice",
  });
  await expect(lookup.getByText("Local AI", { exact: true })).toBeVisible();
  await lookup.getByRole("button", { name: "保存到 Word Bank" }).click();
  await expect(lookup.getByText("已保存到 Word Bank")).toBeVisible();

  await submitStudyVideoImport(page, {
    uploadCaption: false,
    videoUrl: "https://youtu.be/autocaps001",
  });
  await page.getByRole("button", { name: "查询 Practice" }).click();
  lookup = page.getByRole("complementary", { name: "Word Lookup: Practice" });
  await expect(lookup.getByText("Local AI", { exact: true })).toBeVisible();
  await lookup.getByRole("button", { name: "保存到 Word Bank" }).click();
  await expect(lookup.getByText("已保存到 Word Bank")).toBeVisible();

  await page.goto("/");
  const studyVideoCards = page.locator(".study-video-card");
  const manualVideoCard = page.locator(
    '.study-video-card:has(a[href="/study/study-video-nocaptions1"])',
  );
  const automaticVideoCard = page.locator(
    '.study-video-card:has(a[href="/study/study-video-autocaps001"])',
  );
  let bankEntries = page.getByRole("article", { name: /Word Bank: practice/i });
  let manualBankEntry = bankEntries.filter({
    hasText: "Today we're talking about practice.",
  });
  let automaticBankEntry = bankEntries.filter({
    hasText: "Practice with automatic captions.",
  });
  await expect(studyVideoCards).toHaveCount(2);
  await expect(bankEntries).toHaveCount(2);

  await manualVideoCard
    .getByRole("button", { name: /删除 Study Video/ })
    .click();
  let confirmation = page.getByRole("dialog", { name: "删除 Study Video？" });
  await expect(confirmation).toContainText(
    "默认保留 Word Bank 中已保存的表达和原 Learning Sentence",
  );
  let removeContexts = confirmation.getByRole("checkbox", {
    name: /同时移除仅来自该视频的 Word Bank 语境/,
  });
  await expect(removeContexts).not.toBeChecked();
  await confirmation.getByRole("button", { name: "取消" }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(studyVideoCards).toHaveCount(2);
  await expect(bankEntries).toHaveCount(2);

  await page.reload();
  await expect(studyVideoCards).toHaveCount(2);
  await expect(bankEntries).toHaveCount(2);

  await manualVideoCard
    .getByRole("button", { name: /删除 Study Video/ })
    .click();
  confirmation = page.getByRole("dialog", { name: "删除 Study Video？" });
  await page.evaluate(() => {
    const originalTransaction = IDBDatabase.prototype.transaction;
    Reflect.set(window, "__originalIdbTransaction", originalTransaction);
    Reflect.set(
      IDBDatabase.prototype,
      "transaction",
      function (
        this: IDBDatabase,
        storeNames: string | string[],
        mode?: IDBTransactionMode,
        options?: IDBTransactionOptions,
      ) {
        const names = typeof storeNames === "string" ? [storeNames] : storeNames;
        if (
          mode === "readwrite" &&
          names.includes("study-videos") &&
          names.includes("word-bank")
        ) {
          throw new DOMException("Simulated interrupted deletion", "AbortError");
        }
        return Reflect.apply(originalTransaction, this, [
          storeNames,
          mode,
          options,
        ]);
      },
    );
  });
  await confirmation.getByRole("button", { name: "删除视频" }).click();
  await expect(
    confirmation.getByRole("alert").filter({ hasText: "本地数据没有改变" }),
  ).toBeVisible();
  await expect(studyVideoCards).toHaveCount(2);
  await expect(bankEntries).toHaveCount(2);
  await page.evaluate(() => {
    Reflect.set(
      IDBDatabase.prototype,
      "transaction",
      Reflect.get(window, "__originalIdbTransaction"),
    );
  });

  await confirmation.getByRole("button", { name: "删除视频" }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(manualVideoCard).toHaveCount(0);
  await expect(studyVideoCards).toHaveCount(1);
  await expect(manualBankEntry).toContainText("来源 Study Video 已不在学习库");
  await expect(
    manualBankEntry.getByRole("link", { name: "回到原句并播放" }),
  ).toHaveCount(0);
  await expect(
    automaticBankEntry.getByRole("link", { name: "回到原句并播放" }),
  ).toBeVisible();

  await page.reload();
  bankEntries = page.getByRole("article", { name: /Word Bank: practice/i });
  manualBankEntry = bankEntries.filter({
    hasText: "Today we're talking about practice.",
  });
  automaticBankEntry = bankEntries.filter({
    hasText: "Practice with automatic captions.",
  });
  await expect(studyVideoCards).toHaveCount(1);
  await expect(bankEntries).toHaveCount(2);
  await expect(manualBankEntry).toContainText("来源 Study Video 已不在学习库");

  await automaticVideoCard
    .getByRole("button", { name: /删除 Study Video/ })
    .click();
  confirmation = page.getByRole("dialog", { name: "删除 Study Video？" });
  removeContexts = confirmation.getByRole("checkbox", {
    name: /同时移除仅来自该视频的 Word Bank 语境/,
  });
  await removeContexts.check();
  await confirmation.getByRole("button", { name: "删除视频" }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(studyVideoCards).toHaveCount(0);
  await expect(bankEntries).toHaveCount(1);
  await expect(manualBankEntry).toBeVisible();
  await expect(automaticBankEntry).toHaveCount(0);

  await page.reload();
  await expect(studyVideoCards).toHaveCount(0);
  await expect(
    page.getByRole("article", { name: /Word Bank: practice/i }),
  ).toHaveCount(1);
  await expect(
    page
      .getByRole("article", { name: /Word Bank: practice/i })
      .filter({ hasText: "Today we're talking about practice." }),
  ).toBeVisible();
});

test("versioned backup safely round-trips all local learning data", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  await request.post("http://127.0.0.1:4174/reset");
  await request.post("http://127.0.0.1:4176/reset");
  await request.post("http://127.0.0.1:4177/reset");
  await installYouTubePlayerBoundary(page, { duration: 74 });
  await submitStudyVideoImport(page);

  await page.getByRole("button", { name: "查询 talking" }).click();
  let lookup = page.getByRole("complementary", {
    name: "Word Lookup: talking",
  });
  await lookup.getByRole("button", { name: "同意并使用 DeepSeek" }).click();
  await expect(lookup.getByText("DeepSeek", { exact: true })).toBeVisible();
  await lookup.getByRole("button", { name: "保存到 Word Bank" }).click();
  await expect(lookup.getByText("已保存到 Word Bank")).toBeVisible();

  await page.goto("/");
  const manualVideoCard = page.locator(
    '.study-video-card:has(a[href="/study/study-video-nocaptions1"])',
  );
  await manualVideoCard
    .getByRole("button", { name: /删除 Study Video/ })
    .click();
  await page
    .getByRole("dialog", { name: "删除 Study Video？" })
    .getByRole("button", { name: "删除视频" })
    .click();
  await expect(manualVideoCard).toHaveCount(0);

  await submitStudyVideoImport(page, {
    uploadCaption: false,
    videoUrl: "https://youtu.be/autocaps001",
  });
  await page.getByRole("button", { name: "编辑第 1 句" }).click();
  const editor = page.getByRole("region", { name: "编辑第 1 句" });
  await editor
    .getByLabel("句子文本")
    .fill("Practice with restored automatic captions.");
  await editor.getByRole("button", { name: "保存修订" }).click();
  await expect(page.getByText("Local Revision", { exact: true })).toBeVisible();
  await page.evaluate(() => Reflect.get(window, "__setYouTubeCurrentTime")(5));
  await expect(page.getByText("上次位置 0:05")).toBeVisible();

  await page.getByRole("button", { name: "查询 Practice" }).click();
  lookup = page.getByRole("complementary", { name: "Word Lookup: Practice" });
  await expect(lookup.getByText("Local AI", { exact: true })).toBeVisible();
  await lookup.getByRole("button", { name: "保存到 Word Bank" }).click();
  await expect(lookup.getByText("已保存到 Word Bank")).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: "设置与诊断" }).click();
  await page.getByRole("checkbox", { name: "默认隐藏字幕" }).check();
  await expect(page.getByText("偏好已保存")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出全部本地数据" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^learn-my-english-backup-\d{4}-\d{2}-\d{2}\.json$/,
  );
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("Backup download did not produce a file");
  const backupText = await readFile(downloadPath, "utf8");
  const backup = JSON.parse(backupText);
  expect(backup.backupSchemaVersion).toBe(1);
  expect(backup.application).toBe("learn-my-english");
  expect(backup.data.preferences).toEqual({
    deepSeekCloudConsent: "granted",
    hideTranscriptByDefault: true,
  });
  expect(backup.data.studyLibrary).toHaveLength(1);
  expect(backup.data.studyLibrary[0].localRevision.sentences[0].text).toBe(
    "Practice with restored automatic captions.",
  );
  expect(backup.data.studyLibrary[0].lastPositionSeconds).toBe(5);
  expect(backup.data.wordBank).toHaveLength(2);
  expect(backup.data.wordLookups.length).toBeGreaterThan(1);
  expect(backupText).not.toContain("e2e-local-secret");
  expect(backupText).not.toContain("e2e-deepseek-secret");
  expect(backupText).not.toMatch(/data:(?:audio|video)\//);

  const backupInput = page.getByLabel("选择备份 JSON");
  await backupInput.setInputFiles({
    name: "unsupported-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ ...backup, backupSchemaVersion: 999 }),
    ),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "不支持这个备份版本" }),
  ).toBeVisible();

  await backupInput.setInputFiles({
    name: "unsafe-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...backup, apiKey: "must-not-import" })),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "备份结构无效" }),
  ).toBeVisible();

  const conflictingBackup = structuredClone(backup);
  conflictingBackup.data.studyLibrary[0].title = "Conflicting restored title";
  await backupInput.setInputFiles({
    name: "conflicting-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(conflictingBackup)),
  });
  let restoreConfirmation = page.getByRole("dialog", {
    name: "恢复本地学习数据？",
  });
  await expect(restoreConfirmation).toContainText(
    "合并会保留当前数据；遇到同一标识但内容不同会停止整个恢复",
  );
  await restoreConfirmation.getByRole("radio", { name: "合并" }).check();
  await restoreConfirmation
    .getByRole("button", { name: "确认恢复" })
    .click();
  await expect(
    restoreConfirmation
      .getByRole("alert")
      .filter({ hasText: "发现冲突，本地数据没有改变" }),
  ).toBeVisible();
  const stateAfterConflict = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const openRequest = indexedDB.open("learn-my-english", 4);
      openRequest.onsuccess = () => resolve(openRequest.result);
      openRequest.onerror = () => reject(openRequest.error);
    });
    const transaction = database.transaction(
      ["study-videos", "word-bank"],
      "readonly",
    );
    const readAll = (storeName: string) =>
      new Promise<unknown[]>((resolve, reject) => {
        const readRequest = transaction.objectStore(storeName).getAll();
        readRequest.onsuccess = () => resolve(readRequest.result);
        readRequest.onerror = () => reject(readRequest.error);
      });
    const [studyVideos, wordBank] = await Promise.all([
      readAll("study-videos"),
      readAll("word-bank"),
    ]);
    database.close();
    return { studyVideos, wordBank };
  });
  expect(stateAfterConflict.studyVideos).toHaveLength(1);
  expect(stateAfterConflict.studyVideos[0]).not.toMatchObject({
    title: "Conflicting restored title",
  });
  expect(stateAfterConflict.wordBank).toHaveLength(2);
  await restoreConfirmation
    .getByRole("button", { name: "取消恢复" })
    .click();
  await page.getByRole("button", { name: "关闭设置与诊断" }).click();

  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const deleteRequest = indexedDB.deleteDatabase("learn-my-english");
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject(deleteRequest.error);
      }),
  );
  await page.reload();
  await expect(page.getByText("还没有学习视频")).toBeVisible();
  await expect(page.getByText("还没有保存 Word Lookup")).toBeVisible();

  await page.getByRole("button", { name: "设置与诊断" }).click();
  await page.getByLabel("选择备份 JSON").setInputFiles({
    name: "learn-my-english-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(backupText),
  });
  restoreConfirmation = page.getByRole("dialog", {
    name: "恢复本地学习数据？",
  });
  await restoreConfirmation.getByRole("radio", { name: "替换" }).check();
  await expect(restoreConfirmation).toContainText(
    "替换会清空当前学习数据，再完整写入这份备份",
  );
  await restoreConfirmation
    .getByRole("button", { name: "确认恢复" })
    .click();

  const bankEntries = page.getByRole("article", { name: /Word Bank:/ });
  await expect(page.locator(".study-video-card")).toHaveCount(1);
  await expect(bankEntries).toHaveCount(2);
  const unavailableEntry = bankEntries.filter({
    hasText: "Today we're talking about practice.",
  });
  const availableEntry = bankEntries.filter({
    hasText: "Practice with restored automatic captions.",
  });
  await expect(unavailableEntry).toContainText("来源 Study Video 已不在学习库");
  await expect(
    unavailableEntry.getByRole("link", { name: "回到原句并播放" }),
  ).toHaveCount(0);
  await expect(
    availableEntry.getByRole("link", { name: "回到原句并播放" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "设置与诊断" }).click();
  await expect(page.getByRole("checkbox", { name: "默认隐藏字幕" })).toBeChecked();
  await expect(page.getByText("已允许 DeepSeek 云端回退")).toBeVisible();
  await page.getByRole("button", { name: "关闭设置与诊断" }).click();

  await availableEntry.getByRole("link", { name: "回到原句并播放" }).click();
  await expect(page.getByText("已从 Word Bank 返回并播放第 1 句")).toBeVisible();
  await expect(page.getByText("上次位置 0:05")).toBeVisible();
    await page.getByRole("button", { name: "显示原文 T" }).click();
  await expect(
    page.getByText("Practice with restored automatic captions.", { exact: true }),
  ).toBeVisible();
  await page.route("**/api/dictionary**", (route) => route.abort());
  await page.route("**/api/word-lookup/ai", (route) => route.abort());
  await page.getByRole("button", { name: "查询 Practice" }).click();
  lookup = page.getByRole("complementary", { name: "Word Lookup: Practice" });
  await expect(lookup.getByText("Local AI", { exact: true })).toBeVisible();
  await expect(lookup).toContainText("Repetition of an activity to improve a skill.");
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

  const learningSentences = page.locator(".learning-sentence-text");
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

  await expect(page.locator(".learning-sentence-text")).toHaveText([
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
