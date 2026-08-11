"use client";

import { useRef, useState } from "react";

import {
  exportLocalLearningBackup,
  LOCAL_LEARNING_BACKUP_MAXIMUM_BYTES,
  LocalLearningBackupConflictError,
  parseLocalLearningBackupText,
  restoreLocalLearningBackup,
  type LocalLearningBackup,
  type LocalLearningBackupParseResult,
  type LocalLearningRestoreMode,
} from "@/client/local-learning-backup";

type BackupStatus =
  | "idle"
  | "exporting"
  | "exported"
  | "export-error"
  | "restoring"
  | "restore-conflict"
  | "restore-error";

const PARSE_ERROR_COPY: Record<
  Exclude<
    Extract<LocalLearningBackupParseResult, { status: "invalid" }>["reason"],
    never
  >,
  string
> = {
  "invalid-json": "备份文件不是有效 JSON，本地数据没有改变。",
  "invalid-data": "备份结构无效或包含不允许的字段，本地数据没有改变。",
  "too-large": "备份文件超过 25 MB，本地数据没有改变。",
  "unsupported-schema": "不支持这个备份版本，本地数据没有改变。",
};

function backupFileName() {
  return `learn-my-english-backup-${new Date().toISOString().slice(0, 10)}.json`;
}

function downloadBackup(backup: LocalLearningBackup) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = backupFileName();
  link.href = url;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function RestoreConfirmation({
  backup,
  mode,
  onCancel,
  onConfirm,
  onModeChange,
  status,
}: {
  backup: LocalLearningBackup;
  mode: LocalLearningRestoreMode | null;
  onCancel: () => void;
  onConfirm: () => void;
  onModeChange: (mode: LocalLearningRestoreMode) => void;
  status: BackupStatus;
}) {
  const restoring = status === "restoring";
  return (
    <div className="backup-restore-backdrop">
      <section
        aria-labelledby="backup-restore-title"
        aria-modal="true"
        className="backup-restore-dialog"
        role="dialog"
      >
        <p className="eyebrow">VALIDATED BACKUP · SCHEMA V1</p>
        <h3 id="backup-restore-title">恢复本地学习数据？</h3>
        <p className="backup-impact-summary">
          这份备份包含 {backup.data.studyLibrary.length} 个 Study Video、
          {backup.data.wordBank.length} 条 Word Bank 语境和
          {backup.data.wordLookups.length} 条 Word Lookup 缓存。
        </p>

        <div className="backup-mode-options">
          <label>
            <input
              checked={mode === "merge"}
              disabled={restoring}
              name="restore-mode"
              onChange={() => onModeChange("merge")}
              type="radio"
            />
            <span>
              <strong>合并</strong>
              <small>
                合并会保留当前数据；遇到同一标识但内容不同会停止整个恢复。
              </small>
            </span>
          </label>
          <label>
            <input
              checked={mode === "replace"}
              disabled={restoring}
              name="restore-mode"
              onChange={() => onModeChange("replace")}
              type="radio"
            />
            <span>
              <strong>替换</strong>
              <small>
                替换会清空当前学习数据，再完整写入这份备份。不会更改 API
                密钥或本地服务配置。
              </small>
            </span>
          </label>
        </div>

        {status === "restore-conflict" ? (
          <p className="backup-restore-error" role="alert">
            发现冲突，本地数据没有改变。可改用替换，或取消后检查备份。
          </p>
        ) : null}
        {status === "restore-error" ? (
          <p className="backup-restore-error" role="alert">
            恢复未完成，本地数据没有改变。请检查浏览器存储权限后重试。
          </p>
        ) : null}

        <div className="backup-restore-actions">
          <button disabled={restoring} onClick={onCancel} type="button">
            取消恢复
          </button>
          <button
            disabled={restoring || mode === null}
            onClick={onConfirm}
            type="button"
          >
            {restoring ? "正在恢复…" : "确认恢复"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function LocalDataBackupControls({
  persistenceAvailable,
}: {
  persistenceAvailable: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<BackupStatus>("idle");
  const [parseError, setParseError] = useState<string | null>(null);
  const [pendingBackup, setPendingBackup] =
    useState<LocalLearningBackup | null>(null);
  const [restoreMode, setRestoreMode] =
    useState<LocalLearningRestoreMode | null>(null);

  const exportBackup = async () => {
    setStatus("exporting");
    setParseError(null);
    try {
      const backup = await exportLocalLearningBackup();
      downloadBackup(backup);
      setStatus("exported");
    } catch {
      setStatus("export-error");
    }
  };

  const chooseBackup = async (file: File | undefined) => {
    setPendingBackup(null);
    setRestoreMode(null);
    setStatus("idle");
    setParseError(null);
    if (!file) return;
    if (file.size > LOCAL_LEARNING_BACKUP_MAXIMUM_BYTES) {
      setParseError(PARSE_ERROR_COPY["too-large"]);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setParseError(PARSE_ERROR_COPY["invalid-json"]);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    const result = parseLocalLearningBackupText(text);
    if (result.status === "invalid") {
      setParseError(PARSE_ERROR_COPY[result.reason]);
    } else {
      setPendingBackup(result.backup);
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  const cancelRestore = () => {
    if (status === "restoring") return;
    setPendingBackup(null);
    setRestoreMode(null);
    setStatus("idle");
  };

  const confirmRestore = async () => {
    if (!pendingBackup || !restoreMode || status === "restoring") return;
    setStatus("restoring");
    try {
      await restoreLocalLearningBackup(pendingBackup, restoreMode);
      window.location.reload();
    } catch (cause) {
      setStatus(
        cause instanceof LocalLearningBackupConflictError
          ? "restore-conflict"
          : "restore-error",
      );
    }
  };

  return (
    <section className="backup-card" aria-labelledby="backup-title">
      <div>
        <p className="eyebrow">LOCAL-FIRST SAFETY</p>
        <h3 id="backup-title">本地数据备份</h3>
        <p>
          JSON 包含学习库、字幕、修订、进度、偏好、同意选择、Lookup
          缓存和 Word Bank；不包含密钥、环境配置或音视频文件。
        </p>
      </div>
      <div className="backup-actions">
        <button
          disabled={!persistenceAvailable || status === "exporting"}
          onClick={() => void exportBackup()}
          type="button"
        >
          {status === "exporting" ? "正在导出…" : "导出全部本地数据"}
        </button>
        <label className={persistenceAvailable ? "" : "disabled"}>
          <span>选择备份 JSON</span>
          <input
            accept="application/json,.json"
            aria-label="选择备份 JSON"
            disabled={!persistenceAvailable}
            onChange={(event) =>
              void chooseBackup(event.currentTarget.files?.[0])
            }
            ref={inputRef}
            type="file"
          />
        </label>
      </div>
      {status === "exported" ? (
        <p className="backup-status" role="status">
          备份已下载。请把 JSON 文件保存在安全位置。
        </p>
      ) : null}
      {status === "export-error" ? (
        <p className="backup-error" role="alert">
          导出失败：本地数据未能形成完整、有效的备份。
        </p>
      ) : null}
      {parseError ? (
        <p className="backup-error" role="alert">
          {parseError}
        </p>
      ) : null}
      {pendingBackup ? (
        <RestoreConfirmation
          backup={pendingBackup}
          mode={restoreMode}
          onCancel={cancelRestore}
          onConfirm={() => void confirmRestore()}
          onModeChange={(mode) => {
            setRestoreMode(mode);
            setStatus("idle");
          }}
          status={status}
        />
      ) : null}
    </section>
  );
}
