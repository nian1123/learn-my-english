import {
  acquireEnglishCaptionSource,
  CaptionProviderError,
} from "@/server/caption-provider";

export const runtime = "nodejs";

const MAXIMUM_DURATION_SECONDS = 3 * 60 * 60;

function captionRequest(value: unknown): {
  durationSeconds?: number;
  videoId: string;
} | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }

  const payload = value as Record<string, unknown>;
  if (
    Object.keys(payload).some(
      (key) => key !== "durationSeconds" && key !== "videoId",
    ) ||
    typeof payload.videoId !== "string"
  ) {
    return null;
  }

  if (payload.durationSeconds === undefined) {
    return { videoId: payload.videoId };
  }
  if (
    typeof payload.durationSeconds !== "number" ||
    !Number.isFinite(payload.durationSeconds) ||
    payload.durationSeconds <= 0 ||
    payload.durationSeconds > MAXIMUM_DURATION_SECONDS
  ) {
    return null;
  }

  return {
    durationSeconds: payload.durationSeconds,
    videoId: payload.videoId,
  };
}

export async function POST(request: Request) {
  let parsedRequest: ReturnType<typeof captionRequest>;
  try {
    parsedRequest = captionRequest(await request.json());
  } catch {
    return Response.json({ error: "字幕请求格式无效。" }, { status: 400 });
  }
  if (!parsedRequest) {
    return Response.json({ error: "字幕请求格式无效。" }, { status: 400 });
  }

  try {
    const captionSource = await acquireEnglishCaptionSource(
      parsedRequest.videoId,
      request.signal,
      parsedRequest.durationSeconds,
    );
    return Response.json(captionSource, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof CaptionProviderError) {
      return Response.json(
        { code: error.code, error: error.message, fallbackAvailable: true },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json(
      {
        code: "failed",
        error: "自动获取英文字幕时发生未知错误。你可以上传 VTT/SRT 文件。",
        fallbackAvailable: true,
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
