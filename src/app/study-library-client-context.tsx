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
  type DeepSeekCloudConsent,
  type LearnerPreferences,
} from "@/client/learner-preferences";

type PersistenceStatus = "checking" | "available" | "unavailable";
type PreferenceStatus = "loading" | "idle" | "saving" | "saved" | "error";
export type NetworkStatus = "checking" | "online" | "offline";

type StudyLibraryClientState = {
  networkStatus: NetworkStatus;
  persistenceStatus: PersistenceStatus;
  preferences: LearnerPreferences;
  preferenceStatus: PreferenceStatus;
  setHideTranscriptByDefault: (checked: boolean) => Promise<void>;
  setDeepSeekCloudConsent: (consent: DeepSeekCloudConsent) => Promise<void>;
};

const StudyLibraryClientContext = createContext<StudyLibraryClientState | null>(
  null,
);

export function useStudyLibraryClient(): StudyLibraryClientState {
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
  const [persistenceStatus, setPersistenceStatus] =
    useState<PersistenceStatus>("checking");
  const [preferences, setPreferences] = useState<LearnerPreferences>(
    DEFAULT_LEARNER_PREFERENCES,
  );
  const [preferenceStatus, setPreferenceStatus] =
    useState<PreferenceStatus>("loading");
  const [networkStatus, setNetworkStatus] =
    useState<NetworkStatus>("checking");

  useEffect(() => {
    const updateNetworkStatus = () => {
      setNetworkStatus(window.navigator.onLine ? "online" : "offline");
    };

    updateNetworkStatus();
    window.addEventListener("online", updateNetworkStatus);
    window.addEventListener("offline", updateNetworkStatus);
    return () => {
      window.removeEventListener("online", updateNetworkStatus);
      window.removeEventListener("offline", updateNetworkStatus);
    };
  }, []);

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

  const savePreferences = async (nextPreferences: LearnerPreferences) => {
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

  const setHideTranscriptByDefault = (checked: boolean) =>
    savePreferences({ ...preferences, hideTranscriptByDefault: checked });

  const setDeepSeekCloudConsent = (consent: DeepSeekCloudConsent) =>
    savePreferences({ ...preferences, deepSeekCloudConsent: consent });

  return (
    <StudyLibraryClientContext.Provider
      value={{
        networkStatus,
        persistenceStatus,
        preferences,
        preferenceStatus,
        setDeepSeekCloudConsent,
        setHideTranscriptByDefault,
      }}
    >
      {children}
    </StudyLibraryClientContext.Provider>
  );
}

export function ConnectivityAlert() {
  const { networkStatus } = useStudyLibraryClient();
  if (networkStatus !== "offline") return null;

  return (
    <div aria-live="polite" className="connectivity-alert" role="status">
      <strong>离线模式</strong>
      <span>
        可继续查看并编辑本地 Study Library、Caption Sources、Learning
        Sentences、Local Revisions、Difficult Sentences、Word Lookup 缓存和 Word Bank；YouTube
        播放、导入及新的词典或 AI 请求已停用。
      </span>
    </div>
  );
}
