const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
]);

export class YouTubeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YouTubeUrlError";
  }
}

export function isYouTubeVideoId(value: string): boolean {
  return YOUTUBE_VIDEO_ID_PATTERN.test(value);
}

export function parseYouTubeVideoUrl(input: string): {
  videoId: string;
  canonicalUrl: string;
} {
  let url: URL;

  try {
    url = new URL(input.trim());
  } catch {
    throw new YouTubeUrlError(
      "请输入完整的 YouTube 视频链接，例如 https://www.youtube.com/watch?v=…",
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new YouTubeUrlError("只支持 http 或 https 的 YouTube 视频链接。");
  }

  let videoId = "";

  if (url.hostname === "youtu.be") {
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length === 1) videoId = pathParts[0] ?? "";
  } else if (YOUTUBE_HOSTS.has(url.hostname) && url.pathname === "/watch") {
    videoId = url.searchParams.get("v") ?? "";
  }

  if (!isYouTubeVideoId(videoId)) {
    throw new YouTubeUrlError(
      "无法识别单一视频。请使用 youtube.com/watch?v=… 或 youtu.be/… 链接。",
    );
  }

  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}
