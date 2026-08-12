"use client";

import { useEffect, useRef, useState } from "react";

import type {
  RuntimeCapability,
  RuntimeDiagnostic,
  RuntimeDiagnosticsResponse,
  RuntimeStatus,
} from "@/domain/runtime-diagnostics";

import { LocalDataBackupControls } from "./local-data-backup-controls";
import { useStudyLibraryClient } from "./study-library-client-context";

const CAPABILITIES: ReadonlyArray<{
  capability: RuntimeCapability | "indexed-db";
  label: string;
  description: string;
}> = [
  {
    capability: "supadata",
    label: "Supadata",
    description: "平台已有字幕（首选）",
  },
  {
    capability: "yt-dlp",
    label: "yt-dlp",
    description: "平台已有字幕（本机回退）",
  },
  {
    capability: "local-ai",
    label: "本地 AI",
    description: "上下文词义增强",
  },
  {
    capability: "deepseek",
    label: "DeepSeek",
    description: "经授权的云端回退",
  },
  {
    capability: "dictionary",
    label: "基础词典",
    description: "英文释义与音标",
  },
  {
    capability: "indexed-db",
    label: "本地数据",
    description: "学习库与偏好",
  },
];

const STATUS_COPY: Record<RuntimeStatus | "checking", string> = {
  available: "可用",
  configured: "已配置",
  "not-configured": "未配置",
  unavailable: "不可用",
  checking: "检查中",
};

function DiagnosticsPanel({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const {
    persistenceStatus,
    preferences,
    preferenceStatus,
    setDeepSeekCloudConsent,
    setHideTranscriptByDefault,
  } = useStudyLibraryClient();
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostic[]>([]);
  const [requestFailed, setRequestFailed] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    dialog.showModal();

    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadDiagnostics() {
      try {
        const response = await fetch("/api/diagnostics", { cache: "no-store" });
        if (!response.ok) throw new Error("diagnostics request failed");
        const payload = (await response.json()) as RuntimeDiagnosticsResponse;
        if (active) setDiagnostics(payload.diagnostics);
      } catch {
        if (active) setRequestFailed(true);
      }
    }

    void loadDiagnostics();

    return () => {
      active = false;
    };
  }, []);

  const statusFor = (
    capability: RuntimeCapability | "indexed-db",
  ): RuntimeStatus | "checking" => {
    if (capability === "indexed-db") return persistenceStatus;
    if (requestFailed) return "unavailable";
    return (
      diagnostics.find((item) => item.capability === capability)?.status ??
      "checking"
    );
  };

  return (
    <dialog
      aria-labelledby="diagnostics-title"
      className="diagnostics-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      ref={dialogRef}
    >
      <section className="diagnostics-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">LOCAL READINESS</p>
            <h2 id="diagnostics-title">运行状态</h2>
            <p>这里只显示连接状态，密钥始终留在本地服务中。</p>
          </div>
          <button className="icon-button" onClick={onClose} type="button">
            <span aria-hidden="true">×</span>
            <span className="sr-only">关闭设置与诊断</span>
          </button>
        </div>

        <div className="diagnostic-list">
          {CAPABILITIES.map((item) => {
            const status = statusFor(item.capability);
            return (
              <article className="diagnostic-row" key={item.capability}>
                <span className={`status-dot status-${status}`} />
                <div>
                  <h3>{item.label}</h3>
                  <p>{item.description}</p>
                </div>
                <span className={`status-label status-${status}`}>
                  {STATUS_COPY[status]}
                </span>
              </article>
            );
          })}
        </div>

        <section className="preference-card" aria-labelledby="preference-title">
          <div>
            <p className="eyebrow">LEARNING PREFERENCE</p>
            <h3 id="preference-title">听力偏好</h3>
            <p>打开 Study Video 时自动应用，学习页仍可临时切换。</p>
          </div>
          <label className="toggle-row">
            <span>
              <strong>默认隐藏字幕</strong>
              <small>先听声音，需要时再显示原文</small>
            </span>
            <input
              checked={preferences.hideTranscriptByDefault}
              disabled={
                preferenceStatus === "loading" ||
                preferenceStatus === "saving" ||
                preferenceStatus === "error"
              }
              onChange={(event) =>
                void setHideTranscriptByDefault(event.target.checked)
              }
              type="checkbox"
            />
          </label>
          <p className={`save-status save-status-${preferenceStatus}`}>
            {preferenceStatus === "saved" ? "偏好已保存" : null}
            {preferenceStatus === "saving" ? "正在保存…" : null}
            {preferenceStatus === "error"
              ? "本地数据不可用，无法保存偏好"
              : null}
          </p>
        </section>

        <section
          className="preference-card cloud-consent-settings"
          aria-labelledby="deepseek-consent-title"
        >
          <div>
            <p className="eyebrow">CLOUD PRIVACY</p>
            <h3 id="deepseek-consent-title">DeepSeek 云端回退</h3>
            <p>
              {preferences.deepSeekCloudConsent === "granted"
                ? "已允许 DeepSeek 云端回退"
                : null}
              {preferences.deepSeekCloudConsent === "declined"
                ? "已拒绝 DeepSeek 云端回退"
                : null}
              {preferences.deepSeekCloudConsent === "unknown"
                ? "尚未决定是否使用 DeepSeek 云端回退"
                : null}
            </p>
            <small>
              只有 Local AI 不可用时才会回退；许可不包含密钥，也不会同步到云端。
            </small>
          </div>
          {preferences.deepSeekCloudConsent !== "unknown" ? (
            <button
              className="secondary-button"
              disabled={
                preferenceStatus === "loading" ||
                preferenceStatus === "saving" ||
                preferenceStatus === "error"
              }
              onClick={() => void setDeepSeekCloudConsent("unknown")}
              type="button"
            >
              {preferences.deepSeekCloudConsent === "granted"
                ? "撤销 DeepSeek 云端许可"
                : "重置 DeepSeek 同意选择"}
            </button>
          ) : null}
        </section>

        <LocalDataBackupControls
          persistenceAvailable={persistenceStatus === "available"}
        />

        <div className="panel-note">
          AI 未配置不会阻止听力学习；本地数据不可用时，应用将停止写入。
        </div>
      </section>
    </dialog>
  );
}

export function SettingsAndDiagnostics() {
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  return (
    <>
      <button
        className="settings-button"
        onClick={() => setShowDiagnostics(true)}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5Z" />
          <path d="m19 13.5 1.4 1.1-2 3.5-1.8-.7a7.5 7.5 0 0 1-2.3 1.3L14 20.6h-4l-.3-1.9a7.5 7.5 0 0 1-2.3-1.3l-1.8.7-2-3.5L5 13.5a7.4 7.4 0 0 1 0-3L3.6 9.4l2-3.5 1.8.7a7.5 7.5 0 0 1 2.3-1.3l.3-1.9h4l.3 1.9a7.5 7.5 0 0 1 2.3 1.3l1.8-.7 2 3.5-1.4 1.1a7.4 7.4 0 0 1 0 3Z" />
        </svg>
        <span>设置与诊断</span>
      </button>
      {showDiagnostics ? (
        <DiagnosticsPanel onClose={() => setShowDiagnostics(false)} />
      ) : null}
    </>
  );
}
