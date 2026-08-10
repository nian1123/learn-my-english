"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
  YouTubeVideoId,
  YouTubeVideoMetadata,
} from "@/domain/study-video";
import {
  captionSourceIdFor,
  studyVideoIdFor,
} from "@/domain/study-video";
import {
  isYouTubeVideoId,
  parseYouTubeVideoUrl,
  YouTubeUrlError,
} from "@/domain/youtube-url";

import { useStudyLibraryClient } from "./study-library-client-context";

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

export type PendingStudyVideoImport = {
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

function metadataResponse(
  value: unknown,
  expectedVideoId: YouTubeVideoId,
): YouTubeVideoMetadata | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;

  if (
    typeof candidate.videoId !== "string" ||
    !isYouTubeVideoId(candidate.videoId) ||
    candidate.videoId !== expectedVideoId ||
    typeof candidate.canonicalUrl !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.channel !== "string" ||
    typeof candidate.thumbnailUrl !== "string"
  ) {
    return null;
  }

  return {
    videoId: candidate.videoId,
    canonicalUrl: candidate.canonicalUrl,
    title: candidate.title,
    channel: candidate.channel,
    thumbnailUrl: candidate.thumbnailUrl,
  };
}

export function useStudyVideoImport() {
  const router = useRouter();
  const { persistenceStatus } = useStudyLibraryClient();
  const [videoUrl, setVideoUrl] = useState("");
  const [captionFile, setCaptionFile] = useState<File | null>(null);
  const [stage, setStage] = useState<ImportStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [youtubeOpenUrl, setYouTubeOpenUrl] = useState<string | null>(null);
  const [pendingImport, setPendingImport] =
    useState<PendingStudyVideoImport | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const importActiveRef = useRef(false);

  useEffect(
    () => () => {
      importActiveRef.current = false;
      abortControllerRef.current?.abort();
    },
    [],
  );

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
        captionSourceIdFor(videoId),
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

      const metadata = metadataResponse(payload, videoId);
      if (!metadata) {
        failImport("读取到的视频信息不完整，请稍后重试。");
        return;
      }

      setPendingImport({ captionSource, learningSentences, metadata });
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
    candidate: PendingStudyVideoImport,
  ) => {
    if (!importActiveRef.current) return;

    const durationSeconds = await waitForDuration(player);
    if (!importActiveRef.current) return;

    if (durationSeconds <= 0) {
      failImport("只支持已结束的普通点播视频；直播或无法读取时长的视频不能导入。");
      return;
    }

    if (durationSeconds > MAXIMUM_DURATION_SECONDS) {
      failImport(
        "视频超过 3 小时，当前 MVP 暂不支持导入。",
        candidate.metadata.canonicalUrl,
      );
      return;
    }

    try {
      setStage("generating");
      const studyVideoId = studyVideoIdFor(candidate.metadata.videoId);
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
  const progressMessage = importing
    ? STAGE_COPY[stage as Exclude<ImportStage, "idle" | "error">]
    : null;

  return {
    cancelImport,
    error,
    finishImport,
    handlePlayerError,
    importing,
    pendingImport,
    persistenceStatus,
    progressMessage,
    setCaptionFile,
    setVideoUrl,
    stage,
    startImport,
    videoUrl,
    youtubeOpenUrl,
  };
}
