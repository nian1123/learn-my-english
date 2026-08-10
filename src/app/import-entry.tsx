"use client";

import { useEffect, useRef, useState } from "react";

import { useStudyVideoImport } from "./use-study-video-import";
import { YouTubePlayer } from "./youtube-player";

export function ImportEntry() {
  const [showImport, setShowImport] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoUrlRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    if (!showImport) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    dialog.showModal();
    videoUrlRef.current?.focus();

    return () => {
      if (dialog.open) dialog.close();
    };
  }, [showImport]);

  const closeImport = () => {
    if (!importing) setShowImport(false);
  };

  return (
    <>
      <button
        aria-expanded={showImport}
        aria-haspopup="dialog"
        className="import-trigger"
        disabled={persistenceStatus !== "available"}
        onClick={() => setShowImport(true)}
        type="button"
      >
        <span aria-hidden="true">＋</span>
        导入视频
      </button>

      {showImport ? (
        <dialog
          aria-labelledby="import-dialog-title"
          className="import-dialog"
          onCancel={(event) => {
            event.preventDefault();
            closeImport();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeImport();
          }}
          ref={dialogRef}
        >
          <form
            className="import-card"
            onSubmit={(event) => {
              event.preventDefault();
              void startImport();
            }}
          >
            <div className="import-dialog-heading">
              <div>
                <p className="eyebrow">NEW STUDY VIDEO</p>
                <h2 id="import-dialog-title">导入 Study Video</h2>
                <p>添加 YouTube 链接与英文字幕文件，我们会先验证视频，再生成可定位的 Learning Sentence。</p>
              </div>
              <button
                aria-label="关闭导入"
                className="icon-button"
                disabled={importing}
                onClick={closeImport}
                type="button"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>

            <div className="import-field">
              <div className="field-heading">
                <span>01</span>
                <label htmlFor="youtube-url">YouTube 视频链接</label>
              </div>
              <input
                disabled={persistenceStatus === "unavailable" || importing}
                id="youtube-url"
                inputMode="url"
                name="youtube-url"
                onChange={(event) => setVideoUrl(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                ref={videoUrlRef}
                type="text"
                value={videoUrl}
              />
            </div>

            <div className="import-field">
              <div className="field-heading">
                <span>02</span>
                <label htmlFor="caption-source">Caption Source 文件</label>
              </div>
              <input
                accept=".vtt,.srt,text/vtt,application/x-subrip"
                disabled={persistenceStatus === "unavailable" || importing}
                id="caption-source"
                name="caption-source"
                onChange={(event) => setCaptionFile(event.target.files?.[0] ?? null)}
                type="file"
              />
              <small>支持英文 .vtt 或 .srt。原始字幕会保留，生成结果可以追溯。</small>
            </div>

            {progressMessage ? (
              <div aria-live="polite" className="import-progress">
                <span aria-hidden="true" />
                <p>{progressMessage}</p>
              </div>
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

            <div className="import-dialog-footer">
              <p>不会下载或托管视频；播放仍由 YouTube 官方播放器完成。</p>
              <div className="import-actions">
                {importing && stage !== "saving" ? (
                  <button className="cancel-button" onClick={cancelImport} type="button">
                    取消导入
                  </button>
                ) : (
                  <button className="cancel-button" onClick={closeImport} type="button">
                    稍后再说
                  </button>
                )}
                <button
                  disabled={persistenceStatus !== "available" || importing}
                  type="submit"
                >
                  {stage === "saving" ? "正在保存" : "开始导入"}
                </button>
              </div>
            </div>
          </form>
        </dialog>
      ) : null}
    </>
  );
}
