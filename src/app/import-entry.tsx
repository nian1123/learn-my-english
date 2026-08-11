"use client";

import { useEffect, useRef, useState } from "react";

import { useStudyVideoImport } from "./use-study-video-import";
import { YouTubePlayer } from "./youtube-player";

const IMPORT_STEPS = [
  { id: "reading-metadata", label: "读取元数据" },
  { id: "checking-embed", label: "检查可嵌入性" },
  { id: "acquiring-captions", label: "获取字幕" },
  { id: "parsing-captions", label: "解析字幕" },
  { id: "generating-sentences", label: "生成学习句" },
  { id: "saving", label: "保存" },
] as const;

export function ImportEntry() {
  const [showImport, setShowImport] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoUrlRef = useRef<HTMLInputElement>(null);
  const {
    cancelImport,
    canSwitchToManualCaption,
    continueWithManualCaption,
    delayLevel,
    error,
    finishImport,
    handlePlayerError,
    importing,
    lastProgressStage,
    manualFallbackAvailable,
    networkStatus,
    pendingImport,
    persistenceStatus,
    progressMessage,
    setCaptionFile,
    setVideoUrl,
    stage,
    startImport,
    switchToManualCaption,
    videoUrl,
    youtubeOpenUrl,
  } = useStudyVideoImport();
  const currentStageLabel = IMPORT_STEPS.find(
    (candidate) => candidate.id === lastProgressStage,
  )?.label;

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
    if (!importing) {
      cancelImport();
      setShowImport(false);
    }
  };

  const cancelAndCloseImport = () => {
    cancelImport();
    setShowImport(false);
  };

  return (
    <>
      <div className="import-entry-action">
        <button
          aria-describedby={
            networkStatus === "offline" ? "offline-import-reason" : undefined
          }
          aria-expanded={showImport}
          aria-haspopup="dialog"
          className="import-trigger"
          disabled={
            persistenceStatus !== "available" || networkStatus !== "online"
          }
          onClick={() => setShowImport(true)}
          type="button"
        >
          <span aria-hidden="true">＋</span>
          导入视频
        </button>
        {networkStatus === "offline" ? (
          <small id="offline-import-reason">离线时不能导入新的 Study Video</small>
        ) : null}
      </div>

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
                <p>
                  粘贴 YouTube 链接后，我们会先验证视频，再尝试获取已有英文字幕并生成 Learning Sentence。
                </p>
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
                disabled={
                  persistenceStatus === "unavailable" ||
                  networkStatus !== "online" ||
                  importing
                }
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

            <p className="import-provider-note">
              自动字幕获取依赖非官方 yt-dlp，可能因 YouTube
              变化而失效；失败后仍可上传英文 VTT/SRT 文件。
            </p>

            {manualFallbackAvailable ? (
              <div className="import-field import-fallback-field">
                <div className="field-heading">
                  <span>02</span>
                  <label htmlFor="caption-source">Caption Source 文件</label>
                </div>
                <input
                  accept=".vtt,.srt,text/vtt,application/x-subrip"
                  disabled={importing}
                  id="caption-source"
                  name="caption-source"
                  onChange={(event) =>
                    setCaptionFile(event.target.files?.[0] ?? null)
                  }
                  type="file"
                />
                <small>
                  自动获取未完成。请选择英文 .vtt 或 .srt
                  继续，原始字幕会保留以便追溯。
                </small>
              </div>
            ) : null}

            {lastProgressStage ? (
              <ol aria-label="导入阶段" className="import-stage-list">
                {IMPORT_STEPS.map((step, index) => {
                  const activeIndex = IMPORT_STEPS.findIndex(
                    (candidate) => candidate.id === lastProgressStage,
                  );
                  const state =
                    index < activeIndex
                      ? "complete"
                      : index === activeIndex
                        ? stage === "error"
                          ? "failed"
                          : "current"
                        : "pending";

                  return (
                    <li
                      aria-current={state === "current" ? "step" : undefined}
                      className={state}
                      key={step.id}
                    >
                      <span aria-hidden="true">{index + 1}</span>
                      {step.label}
                    </li>
                  );
                })}
              </ol>
            ) : null}

            {progressMessage ? (
              <div aria-live="polite" className="import-progress">
                <span aria-hidden="true" />
                <p>{progressMessage}</p>
              </div>
            ) : null}
            {delayLevel === "slow" ? (
              <p className="import-delay-notice" role="status">
                外部服务响应较慢；当前仍在{currentStageLabel ?? "处理"}，阶段信息会持续保留。
              </p>
            ) : null}
            {delayLevel === "prolonged" ? (
              <p className="import-delay-alert" role="alert">
                已等待超过 60 秒。可以取消当前操作
                {canSwitchToManualCaption ? "或改用字幕文件" : "后重试"}
                ；中止不会创建部分 Study Video。
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

            <div className="import-dialog-footer">
              <p>不会下载或托管视频；播放仍由 YouTube 官方播放器完成。</p>
              <div className="import-actions">
                {(importing && stage !== "saving") || manualFallbackAvailable ? (
                  <button
                    className="cancel-button"
                    onClick={cancelAndCloseImport}
                    type="button"
                  >
                    取消导入
                  </button>
                ) : (
                  <button
                    className="cancel-button"
                    onClick={closeImport}
                    type="button"
                  >
                    稍后再说
                  </button>
                )}
                {canSwitchToManualCaption ? (
                  <button
                    className="manual-switch-button"
                    onClick={switchToManualCaption}
                    type="button"
                  >
                    改用字幕文件
                  </button>
                ) : null}
                {manualFallbackAvailable ? (
                  <button
                    disabled={importing}
                    onClick={() => void continueWithManualCaption()}
                    type="button"
                  >
                    使用字幕文件继续
                  </button>
                ) : (
                  <button
                    disabled={
                      persistenceStatus !== "available" ||
                      networkStatus !== "online" ||
                      importing
                    }
                    type="submit"
                  >
                    {stage === "saving" ? "正在保存" : "开始导入"}
                  </button>
                )}
              </div>
            </div>
          </form>
        </dialog>
      ) : null}
    </>
  );
}
