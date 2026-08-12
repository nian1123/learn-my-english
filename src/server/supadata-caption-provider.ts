import "server-only";

import type { AcquiredCaptionSource } from "./caption-acquisition";

const DEFAULT_API_BASE_URL = "https://api.supadata.ai/v1";
const JOB_POLL_INTERVAL_MS = 1_000;
const MAXIMUM_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAXIMUM_SEGMENTS = 100_000;

type TranscriptSegment = {
  duration: number;
  lang: string;
  offset: number;
  text: string;
};

type Transcript = {
  availableLangs: string[];
  content: TranscriptSegment[];
  lang: string;
};

type TranscriptJob = {
  jobId: string;
};

type TranscriptJobStatus =
  | { status: "active" | "queued" }
  | { status: "completed"; transcript: Transcript }
  | { status: "failed" };

export class SupadataCaptionProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupadataCaptionProviderError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnglishLanguage(value: unknown): value is string {
  return typeof value === "string" && /^en(?:$|[-_])/i.test(value);
}

function transcript(value: unknown, durationSeconds?: number): Transcript | null {
  if (!isRecord(value) || !isEnglishLanguage(value.lang)) return null;
  if (
    !Array.isArray(value.availableLangs) ||
    !value.availableLangs.every(
      (language) => typeof language === "string" && language.length <= 50,
    ) ||
    !Array.isArray(value.content) ||
    value.content.length === 0 ||
    value.content.length > MAXIMUM_SEGMENTS
  ) {
    return null;
  }

  const content: TranscriptSegment[] = [];
  for (const segment of value.content) {
    const roundedOffset = isRecord(segment) && typeof segment.offset === "number"
      ? Math.round(segment.offset)
      : Number.NaN;
    const roundedEnd =
      isRecord(segment) &&
      typeof segment.offset === "number" &&
      typeof segment.duration === "number"
        ? Math.round(segment.offset + segment.duration)
        : Number.NaN;
    if (
      !isRecord(segment) ||
      typeof segment.text !== "string" ||
      !segment.text.trim() ||
      segment.text.includes("\0") ||
      !isEnglishLanguage(segment.lang) ||
      typeof segment.offset !== "number" ||
      !Number.isFinite(segment.offset) ||
      segment.offset < 0 ||
      typeof segment.duration !== "number" ||
      !Number.isFinite(segment.duration) ||
      segment.duration <= 0 ||
      !Number.isSafeInteger(roundedOffset) ||
      !Number.isSafeInteger(roundedEnd) ||
      roundedEnd <= roundedOffset ||
      (durationSeconds !== undefined &&
        roundedEnd > Math.round(durationSeconds * 1_000))
    ) {
      return null;
    }
    content.push({
      duration: segment.duration,
      lang: segment.lang,
      offset: segment.offset,
      text: segment.text,
    });
  }

  return {
    availableLangs: value.availableLangs,
    content,
    lang: value.lang,
  };
}

function transcriptJob(value: unknown): TranscriptJob | null {
  if (
    !isRecord(value) ||
    typeof value.jobId !== "string" ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(value.jobId)
  ) {
    return null;
  }
  return { jobId: value.jobId };
}

function transcriptJobStatus(
  value: unknown,
  durationSeconds?: number,
): TranscriptJobStatus | null {
  if (!isRecord(value)) return null;
  if (value.status === "queued" || value.status === "active") {
    return { status: value.status };
  }
  if (value.status === "failed") return { status: "failed" };
  if (value.status !== "completed") return null;
  const completedTranscript = transcript(value, durationSeconds);
  return completedTranscript
    ? { status: "completed", transcript: completedTranscript }
    : null;
}

function vttTimestamp(milliseconds: number): string {
  const roundedMilliseconds = Math.round(milliseconds);
  const hours = Math.floor(roundedMilliseconds / 3_600_000);
  const minutes = Math.floor((roundedMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((roundedMilliseconds % 60_000) / 1_000);
  const remainder = roundedMilliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(remainder).padStart(3, "0")}`;
}

function transcriptVtt(value: Transcript): string {
  const cues = value.content.map((segment) => {
    const start = vttTimestamp(segment.offset);
    const end = vttTimestamp(segment.offset + segment.duration);
    const text = segment.text.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
    return `${start} --> ${end}\n${text}`;
  });
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

function apiBaseUrl(): URL {
  const configured = process.env.SUPADATA_API_BASE_URL?.trim();
  let url: URL;
  try {
    url = new URL(configured || DEFAULT_API_BASE_URL);
  } catch {
    throw new SupadataCaptionProviderError(
      "Supadata 字幕服务地址配置无效。",
    );
  }
  const loopbackHosts = new Set(["127.0.0.1", "[::1]", "localhost"]);
  const secureTransport =
    url.protocol === "https:" ||
    (url.protocol === "http:" && loopbackHosts.has(url.hostname));
  if (!secureTransport || url.username || url.password) {
    throw new SupadataCaptionProviderError(
      "Supadata 字幕服务地址配置无效。",
    );
  }
  return url;
}

async function responsePayload(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAXIMUM_RESPONSE_BYTES
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new SupadataCaptionProviderError("Supadata 返回的字幕超过安全限制。");
  }

  let body = "";
  if (response.body) {
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let receivedBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        receivedBytes += value.byteLength;
        if (receivedBytes > MAXIMUM_RESPONSE_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new SupadataCaptionProviderError(
            "Supadata 返回的字幕超过安全限制。",
          );
        }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } catch (error) {
      if (error instanceof SupadataCaptionProviderError) throw error;
      throw new SupadataCaptionProviderError("Supadata 返回了无效的字幕数据。");
    } finally {
      reader.releaseLock();
    }
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new SupadataCaptionProviderError("Supadata 返回了无效的字幕数据。");
  }
}

function waitForNextPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timeout = setTimeout(finish, JOB_POLL_INTERVAL_MS);
    const abort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    function finish() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function completedJobTranscript(
  jobId: string,
  apiKey: string,
  signal: AbortSignal,
  durationSeconds?: number,
): Promise<Transcript> {
  const statusUrl = new URL(
    `transcript/${encodeURIComponent(jobId)}`,
    `${apiBaseUrl().toString().replace(/\/$/, "")}/`,
  );

  await waitForNextPoll(signal);
  while (true) {
    let response: Response;
    try {
      response = await fetch(statusUrl, {
        cache: "no-store",
        headers: { "x-api-key": apiKey },
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new SupadataCaptionProviderError(
        "无法读取 Supadata 字幕任务状态。",
      );
    }

    const payload = await responsePayload(response);
    if (!response.ok) {
      throw new SupadataCaptionProviderError("Supadata 字幕任务读取失败。");
    }
    const jobStatus = transcriptJobStatus(payload, durationSeconds);
    if (!jobStatus) {
      throw new SupadataCaptionProviderError(
        "Supadata 返回了无效的字幕任务状态。",
      );
    }
    if (jobStatus.status === "completed") return jobStatus.transcript;
    if (jobStatus.status === "failed") {
      throw new SupadataCaptionProviderError("Supadata 字幕任务失败。");
    }
    await waitForNextPoll(signal);
  }
}

export async function acquireSupadataEnglishCaptionSource(
  canonicalUrl: string,
  signal: AbortSignal,
  durationSeconds?: number,
): Promise<AcquiredCaptionSource | null> {
  const apiKey = process.env.SUPADATA_API_KEY?.trim();
  if (!apiKey) return null;

  const requestUrl = new URL("transcript", `${apiBaseUrl().toString().replace(/\/$/, "")}/`);
  requestUrl.searchParams.set("url", canonicalUrl);
  requestUrl.searchParams.set("lang", "en");
  requestUrl.searchParams.set("text", "false");
  requestUrl.searchParams.set("mode", "native");

  let response: Response;
  try {
    response = await fetch(requestUrl, {
      cache: "no-store",
      headers: { "x-api-key": apiKey },
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new SupadataCaptionProviderError(
      "无法连接 Supadata 获取平台已有字幕。",
    );
  }

  const payload = await responsePayload(response);
  let parsed: Transcript | null = null;
  if (response.status === 202) {
    const job = transcriptJob(payload);
    if (!job) {
      throw new SupadataCaptionProviderError(
        "Supadata 返回了无效的字幕任务。",
      );
    }
    parsed = await completedJobTranscript(
      job.jobId,
      apiKey,
      signal,
      durationSeconds,
    );
  } else if (response.status === 200) {
    parsed = transcript(payload, durationSeconds);
  } else {
    throw new SupadataCaptionProviderError(
      "Supadata 未能取得可用的英文平台字幕。",
    );
  }

  if (!parsed) {
    throw new SupadataCaptionProviderError(
      "Supadata 返回了不完整或非英文的字幕。",
    );
  }

  return {
    contents: transcriptVtt(parsed),
    fileName: "caption.en.vtt",
    format: "vtt",
    kind: "platform-provided",
    provider: "supadata",
  };
}
