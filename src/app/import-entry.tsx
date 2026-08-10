"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { YouTubePlayerInstance } from "@/client/youtube-iframe-api";
import { saveStudyVideo } from "@/client/study-video-library";
import {
  CaptionSourceParseError,
  learningSentencesFromCues,
  parseLearnerCaptionSource,
} from "@/domain/caption-source";
import type {
  CaptionSource,
  LearningSentence,
  YouTubeVideoMetadata,
} from "@/domain/study-video";
import { parseYouTubeVideoUrl, YouTubeUrlError } from "@/domain/youtube-url";

import { useStudyLibraryClient } from "./study-library-client-context";
import { YouTubePlayer } from "./youtube-player";

const MAXIMUM_DURATION_SECONDS = 3 * 60 * 60;
const SUPPORTED_CAPTION_CONTENT_TYPES = new Set([
  "application/srt",
  "application/x-subrip",
  "text/plain",
  "text/srt",
  "text/vtt",
]);

type ImportStage =
  | "idle"
  | "reading-metadata"
  | "checking-embed"
  | "generating"
  | "saving"
  | "error";

type PendingImport = {
  captionSource: CaptionSource;
  learningSentences: LearningSentence[];
  metadata: YouTubeVideoMetadata;
};

const STAGE_COPY: Record<Exclude<ImportStage, "idle" | "error">, string> = {
  "reading-metadata": "正在读取视频信息…",
  "checking-embed": "正在检查视频是否可嵌入…",
  generating: "正在生成基础 Learning Sentences…",
  saving: "正在保存到学习库…",
};

async function waitForDuration(player: YouTubePlayerInstance): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const duration = player.getDuration();
    if (duration > 0) return duration;
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }

  return 0;
}

function responseError(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    return value.error;
  }

  return "读取视频信息失败，请稍后重试。";
}

export function ImportEntry() {
  const router = useRouter();
  const { persistenceStatus } = useStudyLibraryClient();
  const [videoUrl, setVideoUrl] = useState("");
  const [captionFile, setCaptionFile] = useState<File | null>(null);
  const [stage, setStage] = useState<ImportStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [youtubeOpenUrl, setYouTubeOpenUrl] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const importActiveRef = useRef(false);

  const resetError = () => {
    setError(null);
    setYouTubeOpenUrl(null);
  };

  const failImport = (message: string, openUrl?: string) => {
    importActiveRef.current = false;
    setPendingImport(null);
    setStage("error");
    setError(message);
    setYouTubeOpenUrl(openUrl ?? null);
  };

  const startImport = async () => {
    resetError();

    if (persistenceStatus !== "available") {
      failImport("本地数据尚未就绪，请刷新页面后重试。");
      return;
    }

    if (!captionFile) {
      failImport("请选择一个 .vtt 或 .srt 格式的 Caption Source。");
      return;
    }

    if (
      captionFile.type &&
      !SUPPORTED_CAPTION_CONTENT_TYPES.has(captionFile.type.toLowerCase())
    ) {
      failImport(
        `文件内容类型 ${captionFile.type} 不受支持，请选择有效的 VTT 或 SRT 文本。`,
      );
      return;
    }

    try {
      const { videoId } = parseYouTubeVideoUrl(videoUrl);
      const captionSource = parseLearnerCaptionSource(
        `caption-${videoId}`,
        captionFile.name,
        await captionFile.text(),
      );
      const learningSentences = learningSentencesFromCues(captionSource);
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      importActiveRef.current = true;
      setStage("reading-metadata");

      const response = await fetch(
        `/api/youtube/metadata?videoId=${encodeURIComponent(videoId)}`,
        { cache: "no-store", signal: abortController.signal },
      );
      const payload: unknown = await response.json();

      if (!response.ok) {
        failImport(responseError(payload));
        return;
      }

      setPendingImport({
        captionSource,
        learningSentences,
        metadata: payload as YouTubeVideoMetadata,
      });
      setStage("checking-embed");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (
        caught instanceof YouTubeUrlError ||
        caught instanceof CaptionSourceParseError
      ) {
        failImport(caught.message);
        return;
      }
      failImport("导入准备失败，请检查链接和 Caption Source 后重试。");
    }
  };

  const finishImport = async (
    player: YouTubePlayerInstance,
    candidate: PendingImport,
  ) => {
    if (!importActiveRef.current) return;

    const durationSeconds = await waitForDuration(player);
    if (!importActiveRef.current) return;

    if (durationSeconds <= 0) {
      failImport("只支持已结束的普通点播视频；直播或无法读取时长的视频不能导入。");
      return;
    }

    if (durationSeconds > MAXIMUM_DURATION_SECONDS) {
      failImport("视频超过 3 小时，当前 MVP 暂不支持导入。", candidate.metadata.canonicalUrl);
      return;
    }

    try {
      setStage("generating");
      const studyVideoId = `study-video-${candidate.metadata.videoId}`;
      setStage("saving");
      await saveStudyVideo({
        schemaVersion: 1,
        id: studyVideoId,
        youtubeVideoId: candidate.metadata.videoId,
        title: candidate.metadata.title,
        channel: candidate.metadata.channel,
        thumbnailUrl: candidate.metadata.thumbnailUrl,
        durationSeconds,
        lastPositionSeconds: 0,
        lastStudiedAt: new Date().toISOString(),
        captionSource: candidate.captionSource,
        learningSentences: candidate.learningSentences,
      });
      importActiveRef.current = false;
      router.push(`/study/${encodeURIComponent(studyVideoId)}`);
    } catch {
      failImport("保存失败，没有创建任何 Study Video。请检查浏览器本地数据权限。");
    }
  };

  const handlePlayerError = (code: number) => {
    if (code === 101 || code === 150) {
      failImport(
        "视频所有者不允许嵌入，无法用于逐句学习。",
        pendingImport?.metadata.canonicalUrl,
      );
      return;
    }

    if (code === 100) {
      failImport("视频不存在、已删除或不是公开内容。");
      return;
    }

    failImport(`YouTube 播放器无法载入该视频（错误 ${code}）。`);
  };

  const cancelImport = () => {
    importActiveRef.current = false;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setPendingImport(null);
    setStage("idle");
    resetError();
  };

  const importing = stage !== "idle" && stage !== "error";

  return (
    <form
      className="import-card"
      onSubmit={(event) => {
        event.preventDefault();
        void startImport();
      }}
    >
      <label htmlFor="youtube-url">YouTube 视频链接</label>
      <input
        disabled={persistenceStatus === "unavailable" || importing}
        id="youtube-url"
        name="youtube-url"
        onChange={(event) => setVideoUrl(event.target.value)}
        placeholder="https://www.youtube.com/watch?v=..."
        type="url"
        value={videoUrl}
      />

      <label htmlFor="caption-source">Caption Source 文件</label>
      <input
        accept=".vtt,.srt,text/vtt,application/x-subrip"
        disabled={persistenceStatus === "unavailable" || importing}
        id="caption-source"
        name="caption-source"
        onChange={(event) => setCaptionFile(event.target.files?.[0] ?? null)}
        type="file"
      />

      <div className="import-actions">
        <button
          disabled={persistenceStatus !== "available" || importing}
          type="submit"
        >
          导入视频
        </button>
        {importing && stage !== "saving" ? (
          <button className="cancel-button" onClick={cancelImport} type="button">
            取消导入
          </button>
        ) : null}
      </div>

      {importing ? (
        <p aria-live="polite" className="import-progress">
          {STAGE_COPY[stage as Exclude<ImportStage, "idle" | "error">]}
        </p>
      ) : null}
      {error ? (
        <div className="import-error" role="alert">
          <span>{error}</span>
          {youtubeOpenUrl ? (
            <a href={youtubeOpenUrl} rel="noreferrer" target="_blank">
              在 YouTube 打开
            </a>
          ) : null}
        </div>
      ) : null}

      {pendingImport ? (
        <YouTubePlayer
          className="import-player-check"
          onError={handlePlayerError}
          onReady={(player) => void finishImport(player, pendingImport)}
          videoId={pendingImport.metadata.videoId}
        />
      ) : null}

      <p>
        自动字幕依赖非官方的 yt-dlp，可能失效；你提供的 Caption Source（.vtt 或
        .srt 格式）始终是可靠回退。
      </p>
    </form>
  );
}
