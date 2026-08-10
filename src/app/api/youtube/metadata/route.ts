import { readYouTubeMetadata, YouTubeMetadataError } from "@/server/youtube-metadata";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const videoId = new URL(request.url).searchParams.get("videoId") ?? "";

  try {
    const metadata = await readYouTubeMetadata(videoId);
    return Response.json(metadata, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof YouTubeMetadataError) {
      return Response.json(
        { error: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json(
      { error: "读取视频信息时发生未知错误。" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
