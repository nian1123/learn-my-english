"use client";

import { useStudyLibraryClient } from "./study-library-client-context";

export function ImportEntry() {
  const { persistenceStatus } = useStudyLibraryClient();

  return (
    <form className="import-card" onSubmit={(event) => event.preventDefault()}>
      <label htmlFor="youtube-url">YouTube 视频链接</label>
      <div className="import-row">
        <input
          disabled={persistenceStatus === "unavailable"}
          id="youtube-url"
          name="youtube-url"
          placeholder="https://www.youtube.com/watch?v=..."
          type="url"
        />
        <button disabled type="submit">
          导入视频
        </button>
      </div>
      <p>
        自动字幕依赖非官方的 yt-dlp，可能失效；导入开放后可改用你提供的 Caption
        Source（.vtt 或 .srt 格式）。
      </p>
    </form>
  );
}
