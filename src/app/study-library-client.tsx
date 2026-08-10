"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

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
    description: "自动字幕获取（非官方）",
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

type PersistenceStatus = "checking" | "available" | "unavailable";
type PreferenceStatus = "loading" | "idle" | "saving" | "saved" | "error";

type StudyLibraryClientState = {
  closeDiagnostics: () => void;
  openDiagnostics: () => void;
  persistenceStatus: PersistenceStatus;
  preferences: LearnerPreferences;
  preferenceStatus: PreferenceStatus;
  setHideTranscriptByDefault: (checked: boolean) => Promise<void>;
  showDiagnostics: boolean;
};

const StudyLibraryClientContext = createContext<StudyLibraryClientState | null>(
  null,
);

function useStudyLibraryClient(): StudyLibraryClientState {
  const context = useContext(StudyLibraryClientContext);

  if (!context) {
    throw new Error(
      "Study Library client controls require StudyLibraryClientProvider",
    );
  }

  return context;
}

export function StudyLibraryClientProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [persistenceStatus, setPersistenceStatus] =
    useState<PersistenceStatus>("checking");
  const [preferences, setPreferences] = useState<LearnerPreferences>(
    DEFAULT_LEARNER_PREFERENCES,
  );
  const [preferenceStatus, setPreferenceStatus] =
    useState<PreferenceStatus>("loading");

  useEffect(() => {
    let active = true;

    readLearnerPreferences()
      .then((storedPreferences) => {
        if (!active) return;
        setPreferences(storedPreferences);
        setPersistenceStatus("available");
        setPreferenceStatus("idle");
      })
      .catch(() => {
        if (!active) return;
        setPersistenceStatus("unavailable");
        setPreferenceStatus("error");
      });

    return () => {
      active = false;
    };
  }, []);

  const setHideTranscriptByDefault = async (checked: boolean) => {
    const nextPreferences = {
      ...preferences,
      hideTranscriptByDefault: checked,
    };

    setPreferences(nextPreferences);
    setPreferenceStatus("saving");

    try {
      await writeLearnerPreferences(nextPreferences);
      setPersistenceStatus("available");
      setPreferenceStatus("saved");
    } catch {
      setPersistenceStatus("unavailable");
      setPreferenceStatus("error");
    }
  };

  return (
    <StudyLibraryClientContext.Provider
      value={{
        closeDiagnostics: () => setShowDiagnostics(false),
        openDiagnostics: () => setShowDiagnostics(true),
        persistenceStatus,
        preferences,
        preferenceStatus,
        setHideTranscriptByDefault,
        showDiagnostics,
      }}
    >
      {children}
    </StudyLibraryClientContext.Provider>
  );
}

export function PersistenceAlert() {
  const { persistenceStatus } = useStudyLibraryClient();

  if (persistenceStatus !== "unavailable") return null;

  return (
    <div className="blocking-alert" role="alert">
      <strong>本地数据不可用，暂时不能保存学习内容</strong>
      <span>请检查 Chrome 的网站数据权限，然后刷新页面重试。</span>
    </div>
  );
}

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
        自动字幕依赖非官方的 yt-dlp，可能失效；导入开放后可改用自己的 .vtt 或
        .srt 字幕。
      </p>
    </form>
  );
}

function DiagnosticsPanel() {
  const {
    closeDiagnostics,
    persistenceStatus,
    preferences,
    preferenceStatus,
    setHideTranscriptByDefault,
  } = useStudyLibraryClient();
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostic[]>([]);
  const [requestFailed, setRequestFailed] = useState(false);

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
          <button
            className="icon-button"
            onClick={closeDiagnostics}
            type="button"
          >
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
            {preferenceStatus === "error"
              ? "本地数据不可用，无法保存偏好"
              : null}
          </p>
        </section>

        <div className="panel-note">
          AI 未配置不会阻止听力学习；本地数据不可用时，应用将停止写入。
        </div>
      </section>
    </div>
  );
}

export function SettingsAndDiagnostics() {
  const { openDiagnostics, showDiagnostics } = useStudyLibraryClient();

  return (
    <>
      <button
        className="settings-button"
        onClick={openDiagnostics}
        type="button"
      >
        <span aria-hidden="true">●</span>
        设置与诊断
      </button>
      {showDiagnostics ? <DiagnosticsPanel /> : null}
    </>
  );
}
