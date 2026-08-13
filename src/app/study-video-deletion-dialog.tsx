"use client";

import { useEffect, useRef } from "react";

import type { StudyVideo } from "@/domain/study-video";

export function StudyVideoDeletionDialog({
  deleting,
  error,
  onCancel,
  onConfirm,
  onRemoveWordBankContextsChange,
  onRemoveDifficultSentencesChange,
  removeWordBankContexts,
  removeDifficultSentences,
  studyVideo,
}: {
  deleting: boolean;
  error: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onRemoveWordBankContextsChange: (checked: boolean) => void;
  onRemoveDifficultSentencesChange: (checked: boolean) => void;
  removeWordBankContexts: boolean;
  removeDifficultSentences: boolean;
  studyVideo: StudyVideo;
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleting, onCancel]);

  return (
    <div className="deletion-dialog-backdrop">
      <section
        aria-labelledby="deletion-dialog-title"
        aria-modal="true"
        className="deletion-dialog"
        role="dialog"
      >
        <p className="eyebrow">LOCAL DATA · PERMANENT ACTION</p>
        <h2 id="deletion-dialog-title">删除 Study Video？</h2>
        <p className="deletion-dialog-target">{studyVideo.title}</p>
        <p className="deletion-dialog-explanation">
          删除后，该视频、学习进度和本地修订会从学习库移除。默认保留 Word
          Bank 中已保存的表达和原 Learning Sentence，也会保留 Difficult
          Sentences；保留的条目会标记为来源不可用，不再提供播放或跳转。
        </p>

        <label className="deletion-context-option">
          <input
            checked={removeWordBankContexts}
            disabled={deleting}
            onChange={(event) =>
              onRemoveWordBankContextsChange(event.currentTarget.checked)
            }
            type="checkbox"
          />
          <span>
            <strong>同时移除仅来自该视频的 Word Bank 语境</strong>
            <small>同一表达在其他 Study Video 中保存的语境不会被删除。</small>
          </span>
        </label>

        <label className="deletion-context-option">
          <input
            checked={removeDifficultSentences}
            disabled={deleting}
            onChange={(event) =>
              onRemoveDifficultSentencesChange(event.currentTarget.checked)
            }
            type="checkbox"
          />
          <span>
            <strong>同时移除该视频的 Difficult Sentences</strong>
            <small>默认保留难句快照和解析；勾选后才会随视频一起删除。</small>
          </span>
        </label>

        {error ? (
          <p className="deletion-dialog-error" role="alert">
            删除未完成，本地数据没有改变。请重试。
          </p>
        ) : null}

        <div className="deletion-dialog-actions">
          <button
            disabled={deleting}
            onClick={onCancel}
            ref={cancelButtonRef}
            type="button"
          >
            取消
          </button>
          <button disabled={deleting} onClick={onConfirm} type="button">
            {deleting ? "正在删除…" : "删除视频"}
          </button>
        </div>
      </section>
    </div>
  );
}
