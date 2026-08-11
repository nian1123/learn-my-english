"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { saveStudyVideo } from "@/client/study-video-library";
import {
  CaptionSourceParseError,
  learningSentencesFromCues,
  parseCaptionSource,
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
  canonicalYouTubeVideoUrl,
  isYouTubeVideoId,
  parseYouTubeVideoUrl,
  YouTubeUrlError,
} from "@/domain/youtube-url";

import { useStudyLibraryClient } from "./study-library-client-context";
import type { PlayerReadiness } from "./youtube-player";

const MAXIMUM_DURATION_SECONDS = 3 * 60 * 60;
const MAXIMUM_CAPTION_SOURCE_BYTES = 10 * 1024 * 1024;
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
  | "acquiring-captions"
  | "parsing-captions"
  | "generating-sentences"
  | "saving"
  | "error";

type ImportProgressStage = Exclude<ImportStage, "error" | "idle">;
export type ImportDelayLevel = "normal" | "slow" | "prolonged";

const SLOW_IMPORT_THRESHOLD_MS = 30_000;
const PROLONGED_IMPORT_THRESHOLD_MS = 60_000;

export type PendingStudyVideoImport = {
  metadata: YouTubeVideoMetadata;
};

type ValidatedStudyVideoImport = PendingStudyVideoImport & {
  durationSeconds: number;
};

const STAGE_COPY: Record<ImportProgressStage, string> = {
  "reading-metadata": "正在读取视频信息…",
  "checking-embed": "正在检查视频是否可嵌入…",
  "acquiring-captions": "正在通过非官方 yt-dlp 获取英文字幕…",
  "parsing-captions": "正在解析 Caption Source…",
  "generating-sentences": "正在生成 Learning Sentence…",
  saving: "正在保存到学习库…",
};

type CaptionAcquisition = {
  contents: string;
  fileName: string;
  format: "srt" | "vtt";
  kind: "auto-generated" | "manual";
};

async function waitForDuration(player: PlayerReadiness): Promise<number> {
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

function isSafeRemoteUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function isProviderLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Boolean(value.trim()) &&
    value.length <= 500
  );
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
    candidate.canonicalUrl !== canonicalYouTubeVideoUrl(expectedVideoId) ||
    !isProviderLabel(candidate.title) ||
    !isProviderLabel(candidate.channel) ||
    !isSafeRemoteUrl(candidate.thumbnailUrl)
  ) {
    return null;
  }

  return {
    videoId: candidate.videoId,
    canonicalUrl: candidate.canonicalUrl,
    title: candidate.title.trim(),
    channel: candidate.channel.trim(),
    thumbnailUrl: candidate.thumbnailUrl,
  };
}

function captionAcquisitionResponse(value: unknown): CaptionAcquisition | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;

  if (
    typeof candidate.contents !== "string" ||
    new Blob([candidate.contents]).size > MAXIMUM_CAPTION_SOURCE_BYTES ||
    typeof candidate.fileName !== "string" ||
    candidate.fileName.length > 255 ||
    /[/\\]/.test(candidate.fileName) ||
    (candidate.format !== "srt" && candidate.format !== "vtt") ||
    (candidate.kind !== "manual" && candidate.kind !== "auto-generated") ||
    !candidate.fileName.toLowerCase().endsWith(`.${candidate.format}`)
  ) {
    return null;
  }

  return {
    contents: candidate.contents,
    fileName: candidate.fileName,
    format: candidate.format,
    kind: candidate.kind,
  };
}

function validateCaptionDuration(
  captionSource: CaptionSource,
  durationSeconds: number,
) {
  if (
    captionSource.cues.some(
      (cue) =>
        cue.startSeconds >= durationSeconds ||
        cue.endSeconds > durationSeconds,
    )
  ) {
    throw new CaptionSourceParseError(
      "Caption Source 的时间范围超出视频时长。请检查它是否属于这个 Study Video。",
    );
  }
  return captionSource;
}

export function useStudyVideoImport() {
  const router = useRouter();
  const { networkStatus, persistenceStatus } = useStudyLibraryClient();
  const [videoUrl, setVideoUrl] = useState("");
  const [captionFile, setCaptionFile] = useState<File | null>(null);
  const [stage, setStage] = useState<ImportStage>("idle");
  const [lastProgressStage, setLastProgressStage] =
    useState<ImportProgressStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [youtubeOpenUrl, setYouTubeOpenUrl] = useState<string | null>(null);
  const [pendingImport, setPendingImport] =
    useState<PendingStudyVideoImport | null>(null);
  const [manualFallback, setManualFallback] =
    useState<ValidatedStudyVideoImport | null>(null);
  const [delayLevel, setDelayLevel] =
    useState<ImportDelayLevel>("normal");
  const abortControllerRef = useRef<AbortController | null>(null);
  const importActiveRef = useRef(false);
  const validatedCandidateRef = useRef<ValidatedStudyVideoImport | null>(null);
  const importing = stage !== "idle" && stage !== "error";

  useEffect(() => {
    if (!importing) {
      setDelayLevel("normal");
      return;
    }

    const slowTimer = window.setTimeout(
      () => setDelayLevel("slow"),
      SLOW_IMPORT_THRESHOLD_MS,
    );
    const prolongedTimer = window.setTimeout(
      () => setDelayLevel("prolonged"),
      PROLONGED_IMPORT_THRESHOLD_MS,
    );
    return () => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(prolongedTimer);
    };
  }, [importing]);

  useEffect(() => {
    if (
      networkStatus !== "offline" ||
      !importActiveRef.current ||
      !["reading-metadata", "checking-embed", "acquiring-captions"].includes(
        stage,
      )
    ) {
      return;
    }

    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    importActiveRef.current = false;
    setPendingImport(null);
    const validatedCandidate = validatedCandidateRef.current;
    if (validatedCandidate) {
      setManualFallback(validatedCandidate);
      setStage("error");
      setError(
        "网络连接已断开，自动获取已停止。可以上传本地 VTT/SRT Caption Source 继续。",
      );
      setYouTubeOpenUrl(validatedCandidate.metadata.canonicalUrl);
      return;
    }
    setManualFallback(null);
    setStage("error");
    setError("网络连接已断开，导入已经停止，没有创建任何 Study Video。");
    setYouTubeOpenUrl(null);
  }, [networkStatus, stage]);

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

  const advanceImport = (nextStage: ImportProgressStage) => {
    setLastProgressStage(nextStage);
    setStage(nextStage);
  };

  const paintImportStage = async (nextStage: ImportProgressStage) => {
    advanceImport(nextStage);
    await new Promise<void>((resolve) =>
      window.requestAnimationFrame(() => resolve()),
    );
  };

  const failImport = (message: string, openUrl?: string) => {
    importActiveRef.current = false;
    validatedCandidateRef.current = null;
    setPendingImport(null);
    setManualFallback(null);
    setStage("error");
    setError(message);
    setYouTubeOpenUrl(openUrl ?? null);
  };

  const offerManualFallback = (
    message: string,
    candidate: ValidatedStudyVideoImport,
  ) => {
    importActiveRef.current = false;
    validatedCandidateRef.current = candidate;
    setPendingImport(null);
    setManualFallback(candidate);
    setStage("error");
    setError(message);
    setYouTubeOpenUrl(candidate.metadata.canonicalUrl);
  };

  const persistStudyVideo = async (
    candidate: ValidatedStudyVideoImport,
    captionSource: CaptionSource,
    learningSentences: LearningSentence[],
  ) => {
    const studyVideoId = studyVideoIdFor(candidate.metadata.videoId);
    await paintImportStage("saving");
    await saveStudyVideo({
      schemaVersion: 1,
      id: studyVideoId,
      youtubeVideoId: candidate.metadata.videoId,
      title: candidate.metadata.title,
      channel: candidate.metadata.channel,
      thumbnailUrl: candidate.metadata.thumbnailUrl,
      durationSeconds: candidate.durationSeconds,
      lastPositionSeconds: 0,
      lastStudiedAt: new Date().toISOString(),
      captionSource,
      learningSentences,
    });
    importActiveRef.current = false;
    validatedCandidateRef.current = null;
    setManualFallback(null);
    router.push(`/study/${encodeURIComponent(studyVideoId)}`);
  };

  const startImport = async () => {
    resetError();
    setLastProgressStage(null);
    setManualFallback(null);
    setCaptionFile(null);

    if (persistenceStatus !== "available") {
      failImport("本地数据尚未就绪，请刷新页面后重试。");
      return;
    }
    if (networkStatus !== "online") {
      failImport("当前离线，无法导入新的 Study Video。请联网后重试。");
      return;
    }

    try {
      const { videoId } = parseYouTubeVideoUrl(videoUrl);
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      importActiveRef.current = true;
      advanceImport("reading-metadata");

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

      setPendingImport({ metadata });
      advanceImport("checking-embed");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (caught instanceof YouTubeUrlError) {
        failImport(caught.message);
        return;
      }
      failImport("导入准备失败，请检查链接后重试。");
    }
  };

  const finishImport = async (
    player: PlayerReadiness,
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

    const validatedCandidate = { ...candidate, durationSeconds };
    validatedCandidateRef.current = validatedCandidate;
    let persistenceStarted = false;
    try {
      const abortController = abortControllerRef.current;
      if (!abortController) return;
      advanceImport("acquiring-captions");
      const captionResponse = await fetch("/api/youtube/captions", {
        body: JSON.stringify({ videoId: candidate.metadata.videoId }),
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: abortController.signal,
      });
      const captionPayload: unknown = await captionResponse.json();
      if (!captionResponse.ok) {
        offerManualFallback(responseError(captionPayload), validatedCandidate);
        return;
      }

      const acquisition = captionAcquisitionResponse(captionPayload);
      if (!acquisition) {
        offerManualFallback(
          "自动字幕服务返回了不完整的 Caption Source。你可以上传 VTT/SRT 文件。",
          validatedCandidate,
        );
        return;
      }

      await paintImportStage("parsing-captions");
      const captionSource = validateCaptionDuration(
        parseCaptionSource(
          captionSourceIdFor(candidate.metadata.videoId),
          acquisition.fileName,
          acquisition.contents,
          acquisition.kind,
        ),
        validatedCandidate.durationSeconds,
      );
      await paintImportStage("generating-sentences");
      const learningSentences = learningSentencesFromCues(captionSource);
      persistenceStarted = true;
      await persistStudyVideo(
        validatedCandidate,
        captionSource,
        learningSentences,
      );
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (caught instanceof CaptionSourceParseError) {
        offerManualFallback(
          `自动获取的 Caption Source 解析失败：${caught.message}`,
          validatedCandidate,
        );
        return;
      }
      if (persistenceStarted) {
        failImport("保存失败，没有创建任何 Study Video。请检查浏览器本地数据权限。");
      } else {
        offerManualFallback(
          "自动字幕服务连接中断或返回异常。你可以重试或上传 VTT/SRT 文件。",
          validatedCandidate,
        );
      }
    }
  };

  const continueWithManualCaption = async () => {
    const candidate = manualFallback;
    resetError();
    if (!candidate) return;

    if (!captionFile) {
      offerManualFallback(
        "请选择一个 .vtt 或 .srt 格式的 Caption Source。",
        candidate,
      );
      return;
    }

    if (captionFile.size > MAXIMUM_CAPTION_SOURCE_BYTES) {
      offerManualFallback(
        "Caption Source 超过 10 MB，请选择更小的 VTT 或 SRT 文本文件。",
        candidate,
      );
      return;
    }

    if (
      captionFile.type &&
      !SUPPORTED_CAPTION_CONTENT_TYPES.has(captionFile.type.toLowerCase())
    ) {
      offerManualFallback(
        `文件内容类型 ${captionFile.type} 不受支持，请选择有效的 VTT 或 SRT 文本。`,
        candidate,
      );
      return;
    }

    importActiveRef.current = true;
    let persistenceStarted = false;
    try {
      await paintImportStage("parsing-captions");
      const captionSource = validateCaptionDuration(
        parseLearnerCaptionSource(
          captionSourceIdFor(candidate.metadata.videoId),
          captionFile.name,
          await captionFile.text(),
        ),
        candidate.durationSeconds,
      );
      await paintImportStage("generating-sentences");
      const learningSentences = learningSentencesFromCues(captionSource);
      persistenceStarted = true;
      await persistStudyVideo(candidate, captionSource, learningSentences);
    } catch (caught) {
      if (caught instanceof CaptionSourceParseError) {
        offerManualFallback(caught.message, candidate);
        return;
      }
      if (persistenceStarted) {
        failImport("保存失败，没有创建任何 Study Video。请检查浏览器本地数据权限。");
      } else {
        offerManualFallback(
          "无法读取这个 Caption Source。请重新选择有效的 VTT/SRT 文件。",
          candidate,
        );
      }
    }
  };

  const switchToManualCaption = () => {
    const candidate = validatedCandidateRef.current;
    if (!candidate || stage !== "acquiring-captions") return;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    offerManualFallback(
      "已停止自动字幕获取。请选择本地 VTT/SRT Caption Source 继续；尚未创建 Study Video。",
      candidate,
    );
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
    validatedCandidateRef.current = null;
    setPendingImport(null);
    setManualFallback(null);
    setCaptionFile(null);
    setStage("idle");
    setLastProgressStage(null);
    resetError();
  };

  const progressMessage = importing
    ? STAGE_COPY[stage as ImportProgressStage]
    : null;

  return {
    cancelImport,
    canSwitchToManualCaption:
      delayLevel === "prolonged" &&
      stage === "acquiring-captions" &&
      validatedCandidateRef.current !== null,
    continueWithManualCaption,
    error,
    finishImport,
    handlePlayerError,
    importing,
    delayLevel,
    lastProgressStage,
    manualFallbackAvailable: manualFallback !== null,
    networkStatus,
    pendingImport,
    persistenceStatus,
    progressMessage,
    setCaptionFile,
    setVideoUrl,
    stage,
    startImport,
    switchToManualCaption,
    videoUrl,
    youtubeOpenUrl,
  };
}
