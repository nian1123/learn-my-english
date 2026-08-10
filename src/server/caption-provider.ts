import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CaptionFormat, CaptionSourceKind } from "@/domain/study-video";
import { canonicalYouTubeVideoUrl, isYouTubeVideoId } from "@/domain/youtube-url";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAXIMUM_PROCESS_OUTPUT_BYTES = 10 * 1024 * 1024;

export type AcquiredCaptionSource = {
  contents: string;
  fileName: string;
  format: CaptionFormat;
  kind: Exclude<CaptionSourceKind, "learner-supplied">;
};

export type CaptionProviderFailureCode =
  | "canceled"
  | "failed"
  | "not-found"
  | "timeout"
  | "unavailable";

export class CaptionProviderError extends Error {
  constructor(
    message: string,
    readonly code: CaptionProviderFailureCode,
    readonly status: number,
  ) {
    super(message);
    this.name = "CaptionProviderError";
  }
}

type ProcessResult = {
  stderr: string;
  stdout: string;
};

function configuredTimeoutMs(): number {
  const configured = Number(process.env.CAPTION_PROVIDER_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 250
    ? Math.min(configured, 120_000)
    : DEFAULT_TIMEOUT_MS;
}

function runYtDlp(
  arguments_: readonly string[],
  signal: AbortSignal,
  timeoutMs: number,
): Promise<ProcessResult> {
  const executable = process.env.YT_DLP_PATH?.trim() || "yt-dlp";

  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new CaptionProviderError("字幕获取已取消。", "canceled", 499));
      return;
    }

    const child = spawn(executable, [...arguments_], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    let timedOut = false;
    let outputBytes = 0;
    let stderr = "";
    let stdout = "";

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => child.kill("SIGTERM");
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    signal.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk);
      stdout += chunk;
      if (outputBytes > MAXIMUM_PROCESS_OUTPUT_BYTES) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk);
      stderr += chunk;
      if (outputBytes > MAXIMUM_PROCESS_OUTPUT_BYTES) child.kill("SIGTERM");
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(() => {
        if (error.code === "ENOENT") {
          reject(
            new CaptionProviderError(
              "本机未找到 yt-dlp。请安装或配置后重试，也可以上传 VTT/SRT 文件。",
              "unavailable",
              503,
            ),
          );
          return;
        }
        reject(
          new CaptionProviderError(
            "yt-dlp 无法启动。请检查安装后重试，也可以上传 VTT/SRT 文件。",
            "failed",
            502,
          ),
        );
      });
    });
    child.on("close", (code) => {
      finish(() => {
        if (signal.aborted) {
          reject(new CaptionProviderError("字幕获取已取消。", "canceled", 499));
          return;
        }
        if (timedOut) {
          reject(
            new CaptionProviderError(
              "自动获取英文字幕超时。你可以重试或上传 VTT/SRT 文件。",
              "timeout",
              504,
            ),
          );
          return;
        }
        if (outputBytes > MAXIMUM_PROCESS_OUTPUT_BYTES || code !== 0) {
          reject(
            new CaptionProviderError(
              "yt-dlp 获取字幕失败。请更新 yt-dlp 后重试，也可以上传 VTT/SRT 文件。",
              "failed",
              502,
            ),
          );
          return;
        }
        resolve({ stderr, stdout });
      });
    });
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function availableLanguages(value: unknown): string[] {
  const tracks = record(value);
  if (!tracks) return [];

  return Object.entries(tracks)
    .filter(([, formats]) => Array.isArray(formats) && formats.length > 0)
    .map(([language]) => language)
    .filter((language) => /^en(?:$|[-_])/i.test(language))
    .sort((left, right) => {
      const priority = (language: string) => {
        const normalized = language.toLowerCase();
        if (normalized === "en") return 0;
        if (normalized === "en-us") return 1;
        if (normalized === "en-gb") return 2;
        if (normalized === "en-orig") return 3;
        return 4;
      };
      return priority(left) - priority(right) || left.localeCompare(right);
    });
}

function selectedTrack(value: unknown): {
  kind: AcquiredCaptionSource["kind"];
  language: string;
} | null {
  const metadata = record(value);
  if (!metadata) return null;

  const manualLanguage = availableLanguages(metadata.subtitles)[0];
  if (manualLanguage) return { kind: "manual", language: manualLanguage };

  const automaticLanguage = availableLanguages(metadata.automatic_captions)[0];
  return automaticLanguage
    ? { kind: "auto-generated", language: automaticLanguage }
    : null;
}

async function downloadedCaption(
  directory: string,
  kind: AcquiredCaptionSource["kind"],
): Promise<AcquiredCaptionSource> {
  const fileName = (await readdir(directory)).find((name) =>
    /\.(?:srt|vtt)$/i.test(name),
  );
  if (!fileName) {
    throw new CaptionProviderError(
      "找到英文字幕轨道，但未能取得可解析的 VTT/SRT 文件。请更新 yt-dlp 或手动上传。",
      "failed",
      502,
    );
  }

  const format = fileName.toLowerCase().endsWith(".srt") ? "srt" : "vtt";
  return {
    contents: await readFile(join(directory, fileName), "utf8"),
    fileName,
    format,
    kind,
  };
}

export async function acquireEnglishCaptionSource(
  videoId: string,
  signal: AbortSignal,
): Promise<AcquiredCaptionSource> {
  if (!isYouTubeVideoId(videoId)) {
    throw new CaptionProviderError("视频标识无效。", "failed", 400);
  }

  const canonicalUrl = canonicalYouTubeVideoUrl(videoId);
  const deadline = Date.now() + configuredTimeoutMs();
  const remainingTime = () => Math.max(1, deadline - Date.now());
  const inspection = await runYtDlp(
    [
      "--ignore-config",
      "--no-playlist",
      "--skip-download",
      "--dump-single-json",
      canonicalUrl,
    ],
    signal,
    remainingTime(),
  );

  let track: ReturnType<typeof selectedTrack>;
  try {
    track = selectedTrack(JSON.parse(inspection.stdout));
  } catch {
    throw new CaptionProviderError(
      "yt-dlp 返回了无法识别的字幕信息。请更新后重试，也可以上传 VTT/SRT 文件。",
      "failed",
      502,
    );
  }

  if (!track) {
    throw new CaptionProviderError(
      "没有找到可用的英文字幕。请上传 VTT/SRT Caption Source。",
      "not-found",
      404,
    );
  }

  const directory = await mkdtemp(join(tmpdir(), "learn-english-caption-"));
  try {
    await runYtDlp(
      [
        "--ignore-config",
        "--no-playlist",
        "--skip-download",
        track.kind === "manual" ? "--write-subs" : "--write-auto-subs",
        "--sub-langs",
        track.language,
        "--sub-format",
        "vtt",
        "--paths",
        directory,
        "--output",
        "caption.%(ext)s",
        canonicalUrl,
      ],
      signal,
      remainingTime(),
    );
    return await downloadedCaption(directory, track.kind);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
