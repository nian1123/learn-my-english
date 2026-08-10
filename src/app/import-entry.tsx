"use client";

import { useStudyVideoImport } from "./use-study-video-import";
import { YouTubePlayer } from "./youtube-player";

export function ImportEntry() {
  const {
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
  } = useStudyVideoImport();

  return (
    <form
      className="import-card"
      onSubmit={(event) => {
        event.preventDefault();
        void startImport();
      }}
    >
      <label htmlFor="youtube-url">YouTube 视频链接</label>
      <input
        disabled={persistenceStatus === "unavailable" || importing}
        id="youtube-url"
        inputMode="url"
        name="youtube-url"
        onChange={(event) => setVideoUrl(event.target.value)}
        placeholder="https://www.youtube.com/watch?v=..."
        type="text"
        value={videoUrl}
      />

      <label htmlFor="caption-source">Caption Source 文件</label>
      <input
        accept=".vtt,.srt,text/vtt,application/x-subrip"
        disabled={persistenceStatus === "unavailable" || importing}
        id="caption-source"
        name="caption-source"
        onChange={(event) => setCaptionFile(event.target.files?.[0] ?? null)}
        type="file"
      />

      <div className="import-actions">
        <button
          disabled={persistenceStatus !== "available" || importing}
          type="submit"
        >
          导入视频
        </button>
        {importing && stage !== "saving" ? (
          <button className="cancel-button" onClick={cancelImport} type="button">
            取消导入
          </button>
        ) : null}
      </div>

      {progressMessage ? (
        <p aria-live="polite" className="import-progress">
          {progressMessage}
        </p>
      ) : null}
      {error ? (
        <div className="import-error" role="alert">
          <span>{error}</span>
          {youtubeOpenUrl ? (
            <a href={youtubeOpenUrl} rel="noreferrer" target="_blank">
              在 YouTube 打开
            </a>
          ) : null}
        </div>
      ) : null}

      {pendingImport ? (
        <YouTubePlayer
          className="import-player-check"
          onError={handlePlayerError}
          onReady={(player) => void finishImport(player, pendingImport)}
          videoId={pendingImport.metadata.videoId}
        />
      ) : null}

      <p>
        自动字幕依赖非官方的 yt-dlp，可能失效；你提供的 Caption Source（.vtt 或
        .srt 格式）始终是可靠回退。
      </p>
    </form>
  );
}
