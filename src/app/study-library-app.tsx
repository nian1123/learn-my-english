"use client";

import { useEffect, useState } from "react";

import {
  DEFAULT_LEARNER_PREFERENCES,
  readLearnerPreferences,
  writeLearnerPreferences,
  type LearnerPreferences,
} from "@/client/learner-preferences";
import type {
  RuntimeCapability,
  RuntimeDiagnostic,
  RuntimeDiagnosticsResponse,
  RuntimeStatus,
} from "@/domain/runtime-diagnostics";

const CAPABILITIES: ReadonlyArray<{
  capability: RuntimeCapability | "indexed-db";
  label: string;
  description: string;
}> = [
  {
    capability: "yt-dlp",
    label: "yt-dlp",
    description: "自动字幕获取",
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

function LibraryMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="brand-mark">
      <path d="M12 9.5h16a8 8 0 0 1 8 8v21H20a8 8 0 0 0-8-8v-21Z" />
      <path d="M12 9.5h16a8 8 0 0 1 8 8v21H20a8 8 0 0 0-8-8v-21Z" />
      <path d="M18 16h12M18 22h12" />
    </svg>
  );
}

function EmptyLibraryIllustration() {
  return (
    <svg aria-hidden="true" viewBox="0 0 240 180" className="empty-art">
      <rect x="32" y="30" width="176" height="112" rx="18" />
      <path d="m102 68 52 30-52 30V68Z" />
      <path d="M70 156h100" />
      <circle cx="186" cy="47" r="20" />
      <path d="M178 47h16M186 39v16" />
    </svg>
  );
}

function DiagnosticsPanel({ onClose }: { onClose: () => void }) {
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostic[]>([]);
  const [requestFailed, setRequestFailed] = useState(false);
  const [indexedDbStatus, setIndexedDbStatus] = useState<
    "available" | "unavailable" | "checking"
  >("checking");
  const [preferences, setPreferences] = useState<LearnerPreferences>(
    DEFAULT_LEARNER_PREFERENCES,
  );
  const [preferenceStatus, setPreferenceStatus] = useState<
    "loading" | "idle" | "saving" | "saved" | "error"
  >("loading");

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

    async function loadPreferences() {
      try {
        const storedPreferences = await readLearnerPreferences();
        if (!active) return;
        setPreferences(storedPreferences);
        setIndexedDbStatus("available");
        setPreferenceStatus("idle");
      } catch {
        if (!active) return;
        setIndexedDbStatus("unavailable");
        setPreferenceStatus("error");
      }
    }

    void loadPreferences();

    return () => {
      active = false;
    };
  }, []);

  const statusFor = (
    capability: RuntimeCapability | "indexed-db",
  ): RuntimeStatus | "checking" => {
    if (capability === "indexed-db") return indexedDbStatus;
    if (requestFailed) return "unavailable";
    return (
      diagnostics.find((item) => item.capability === capability)?.status ??
      "checking"
    );
  };

  const setHideTranscriptByDefault = async (checked: boolean) => {
    const nextPreferences = {
      ...preferences,
      hideTranscriptByDefault: checked,
    };

    setPreferences(nextPreferences);
    setPreferenceStatus("saving");

    try {
      await writeLearnerPreferences(nextPreferences);
      setIndexedDbStatus("available");
      setPreferenceStatus("saved");
    } catch {
      setIndexedDbStatus("unavailable");
      setPreferenceStatus("error");
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-labelledby="diagnostics-title"
        aria-modal="true"
        className="diagnostics-panel"
        role="dialog"
      >
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
            <p>这项设置会在逐句学习功能开放后自动应用。</p>
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
            {preferenceStatus === "error" ? "本地数据不可用，无法保存偏好" : null}
          </p>
        </section>

        <div className="panel-note">
          AI 未配置不会阻止听力学习；本地数据不可用时，应用将停止写入。
        </div>
      </section>
    </div>
  );
}

export function StudyLibraryApp() {
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [persistenceUnavailable, setPersistenceUnavailable] = useState(false);

  useEffect(() => {
    let active = true;

    readLearnerPreferences().catch(() => {
      if (active) setPersistenceUnavailable(true);
    });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Learn My English 首页">
          <LibraryMark />
          <span>
            <strong>Learn My English</strong>
            <small>逐句听懂真实访谈</small>
          </span>
        </a>
        <button
          className="settings-button"
          onClick={() => setShowDiagnostics(true)}
          type="button"
        >
          <span aria-hidden="true">●</span>
          设置与诊断
        </button>
      </header>

      {persistenceUnavailable ? (
        <div className="blocking-alert" role="alert">
          <strong>本地数据不可用，暂时不能保存学习内容</strong>
          <span>请检查 Chrome 的网站数据权限，然后刷新页面重试。</span>
        </div>
      ) : null}

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">AMERICAN ENGLISH · LISTEN SENTENCE BY SENTENCE</p>
          <h1>我的学习库</h1>
          <p className="hero-lede">
            从你真正想看的访谈开始，把自然语速拆成一句一句，听清楚，再开口。
          </p>
        </div>

        <form className="import-card" onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="youtube-url">YouTube 视频链接</label>
          <div className="import-row">
            <input
              disabled={persistenceUnavailable}
              id="youtube-url"
              name="youtube-url"
              placeholder="https://www.youtube.com/watch?v=..."
              type="url"
            />
            <button disabled type="submit">
              导入视频
            </button>
          </div>
          <p>当前版本先完成本地环境检查；视频导入功能即将开放。</p>
        </form>
      </section>

      <section className="library-section" aria-labelledby="library-empty-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">STUDY LIBRARY</p>
            <h2>最近学习</h2>
          </div>
          <span className="count-pill">0 个视频</span>
        </div>

        <div className="empty-state">
          <EmptyLibraryIllustration />
          <div>
            <p className="empty-kicker">YOUR FIRST INTERVIEW</p>
            <h3 id="library-empty-title">还没有学习视频</h3>
            <p>
              准备好后，把一段有英文字幕、可公开播放的 YouTube
              访谈加入这里。
            </p>
          </div>
        </div>
      </section>

      <footer>
        <span>本地优先 · 学习数据留在这台浏览器</span>
        <span>环境诊断已就绪</span>
      </footer>

      {showDiagnostics ? (
        <DiagnosticsPanel onClose={() => setShowDiagnostics(false)} />
      ) : null}
    </main>
  );
}
