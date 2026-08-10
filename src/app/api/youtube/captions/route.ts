import {
  acquireEnglishCaptionSource,
  CaptionProviderError,
} from "@/server/caption-provider";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let videoId = "";
  try {
    const payload: unknown = await request.json();
    if (typeof payload === "object" && payload !== null && "videoId" in payload) {
      videoId = typeof payload.videoId === "string" ? payload.videoId : "";
    }
  } catch {
    return Response.json({ error: "字幕请求格式无效。" }, { status: 400 });
  }

  try {
    const captionSource = await acquireEnglishCaptionSource(
      videoId,
      request.signal,
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
