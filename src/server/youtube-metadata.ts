import "server-only";

import type { YouTubeVideoMetadata } from "@/domain/study-video";
import {
  canonicalYouTubeVideoUrl,
  isYouTubeVideoId,
} from "@/domain/youtube-url";

const METADATA_TIMEOUT_MS = 5_000;
const MAXIMUM_METADATA_RESPONSE_LENGTH = 100_000;

export class YouTubeMetadataError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "YouTubeMetadataError";
  }
}

function nonEmptyProviderText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Boolean(value.trim()) &&
    value.length <= 500
  );
}

function safeThumbnailUrl(value: unknown): value is string {
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

function metadataResponse(value: unknown): {
  title: string;
  author_name: string;
  thumbnail_url: string;
} | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;

  if (
    !nonEmptyProviderText(candidate.title) ||
    !nonEmptyProviderText(candidate.author_name) ||
    !safeThumbnailUrl(candidate.thumbnail_url)
  ) {
    return null;
  }

  return {
    title: candidate.title.trim(),
    author_name: candidate.author_name.trim(),
    thumbnail_url: candidate.thumbnail_url,
  };
}

export async function readYouTubeMetadata(
  videoId: string,
): Promise<YouTubeVideoMetadata> {
  if (!isYouTubeVideoId(videoId)) {
    throw new YouTubeMetadataError("视频标识无效。", 400);
  }

  const canonicalUrl = canonicalYouTubeVideoUrl(videoId);
  const endpoint = new URL(
    process.env.YOUTUBE_OEMBED_BASE_URL?.trim() ||
      "https://www.youtube.com/oembed",
  );
  endpoint.searchParams.set("url", canonicalUrl);
  endpoint.searchParams.set("format", "json");

  let response: Response;
  try {
    response = await fetch(endpoint, {
      cache: "no-store",
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
  } catch {
    throw new YouTubeMetadataError(
      "无法连接 YouTube 读取视频信息，请检查网络后重试。",
      502,
    );
  }

  if (!response.ok) {
    throw new YouTubeMetadataError(
      "无法读取该视频。请确认视频公开且链接仍然有效。",
      response.status === 404 ? 404 : 502,
    );
  }

  let responseText: string;
  try {
    responseText = await response.text();
  } catch {
    throw new YouTubeMetadataError("YouTube 返回的视频信息无法读取。", 502);
  }
  if (responseText.length > MAXIMUM_METADATA_RESPONSE_LENGTH) {
    throw new YouTubeMetadataError("YouTube 返回的视频信息超过安全限制。", 502);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new YouTubeMetadataError("YouTube 返回的视频信息格式无效。", 502);
  }
  const metadata = metadataResponse(payload);
  if (!metadata) {
    throw new YouTubeMetadataError("YouTube 返回的视频信息不完整。", 502);
  }

  return {
    videoId,
    canonicalUrl,
    title: metadata.title,
    channel: metadata.author_name,
    thumbnailUrl: metadata.thumbnail_url,
  };
}
