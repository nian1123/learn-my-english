"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  loadWordLookupAiEnrichment,
  loadWordLookupAiTranslation,
  type LoadedWordLookupAi,
} from "@/client/word-lookup-ai-client";
import { loadWordLookup, type LoadedWordLookup } from "@/client/word-lookup-client";
import type { DeepSeekCloudConsent } from "@/client/learner-preferences";
import {
  readWordBankEntry,
  removeWordBankEntry,
  saveWordBankEntry,
} from "@/client/word-bank";
import {
  dictionarySenseOptions,
  type WordLookupAiEnrichment,
  type WordLookupAiMode,
  type WordLookupAiResponse,
  type WordLookupAiUnavailableReason,
} from "@/domain/word-lookup-ai";
import {
  createWordBankEntry,
  wordBankEntryIdFor,
  type WordBankEntry,
  type WordBankOrigin,
} from "@/domain/word-bank";
import type {
  DictionaryAudio,
  DictionaryLookupResult,
  WordLookupCandidate,
  WordLookupRequest,
} from "@/domain/word-lookup";

import { useStudyLibraryClient } from "./study-library-client-context";

type WordLookupDrawerProps = {
  onClose: () => void;
  origin: WordBankOrigin;
  request: WordLookupRequest;
};

type AvailableTranslation = Extract<
  WordLookupAiResponse,
  { status: "available"; task: "translate" }
>;

type FoundDictionaryResult = Extract<
  DictionaryLookupResult,
  { status: "found" }
>;

function aiUnavailableMessage(reason: WordLookupAiUnavailableReason) {
  switch (reason) {
    case "offline":
      return "当前离线；已保留基础词典结果，没有发起新的 AI 请求";
    case "not-configured":
      return "本地 AI 未配置，当前使用基础词典";
    case "timeout":
      return "本地 AI 响应超时，已保留基础词典结果";
    case "invalid-output":
      return "本地 AI 返回格式无效，已保留基础词典结果";
    case "provider-failure":
      return "本地 AI 暂时不可用，已保留基础词典结果";
    case "deepseek-consent-required":
      return "需要明确同意后才能使用 DeepSeek 云端回退";
    case "deepseek-timeout":
      return "Local AI 不可用，DeepSeek 响应超时，已保留基础词典结果";
    case "deepseek-invalid-output":
      return "Local AI 不可用，DeepSeek 返回格式无效，已保留基础词典结果";
    case "deepseek-provider-failure":
      return "Local AI 不可用，DeepSeek 暂时不可用，已保留基础词典结果";
  }
}

function DeepSeekConsentPrompt({
  onAllow,
  onDecline,
}: {
  onAllow: () => void;
  onDecline: () => void;
}) {
  return (
    <section className="lookup-cloud-consent" aria-labelledby="cloud-consent-title">
      <p className="eyebrow">CLOUD PRIVACY</p>
      <h3 id="cloud-consent-title">允许使用 DeepSeek 云端回退？</h3>
      <p>本地 AI 当前不可用。若继续，以下内容会离开设备并发送到 DeepSeek：</p>
      <ul>
        <li>所选单词或短语</li>
        <li>当前 Learning Sentence</li>
        <li>本次查询所需的基础词典候选义项</li>
      </ul>
      <p>
        不会发送其他字幕、Study Library、学习记录或任何 API 密钥。选择会保存在当前浏览器，可随时在设置与诊断中撤销。
      </p>
      <div className="lookup-cloud-consent-actions">
        <button onClick={onAllow} type="button">
          同意并使用 DeepSeek
        </button>
        <button onClick={onDecline} type="button">
          拒绝，仅使用基础词典
        </button>
      </div>
    </section>
  );
}

function BrowserPronunciation({ candidate }: { candidate: WordLookupCandidate }) {
  const [error, setError] = useState<string | null>(null);

  const speak = () => {
    if (
      typeof window.speechSynthesis === "undefined" ||
      typeof window.SpeechSynthesisUtterance === "undefined"
    ) {
      setError("当前浏览器不支持美式语音合成");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(candidate.normalizedForm);
    utterance.lang = "en-US";
    window.speechSynthesis.speak(utterance);
    setError(null);
  };

  return (
    <div className="lookup-pronunciation">
      <button
        aria-label={`使用浏览器美式发音朗读 ${candidate.normalizedForm}`}
        onClick={speak}
        type="button"
      >
        朗读 <span>浏览器 en-US</span>
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

function DictionaryPronunciation({
  audio,
  candidate,
}: {
  audio: DictionaryAudio;
  candidate: WordLookupCandidate;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playbackFailed, setPlaybackFailed] = useState(false);

  const retry = async () => {
    const element = audioRef.current;
    if (!element) return;

    setPlaybackFailed(false);
    element.load();
    try {
      await element.play();
    } catch {
      setPlaybackFailed(true);
    }
  };

  return (
    <div className="lookup-pronunciation dictionary-audio">
      <span>已确认的美式词典音频</span>
      <audio
        aria-label={`美式发音 ${candidate.normalizedForm}`}
        controls
        onError={() => setPlaybackFailed(true)}
        onPlaying={() => setPlaybackFailed(false)}
        preload="none"
        ref={audioRef}
        src={audio.url}
      />
      {playbackFailed ? (
        <div className="dictionary-audio-recovery">
          <p role="alert">
            美式词典音频播放失败。可以重试，或改用浏览器 en-US 发音。
          </p>
          <button
            aria-label={`重试美式词典音频 ${candidate.normalizedForm}`}
            onClick={() => void retry()}
            type="button"
          >
            重试 <span>词典音频</span>
          </button>
          <BrowserPronunciation candidate={candidate} />
        </div>
      ) : null}
      {audio.license ? (
        <a href={audio.license.url} rel="noreferrer" target="_blank">
          音频许可 {audio.license.name}
        </a>
      ) : null}
    </div>
  );
}

function AiAssistance({
  candidate,
  consent,
  dictionaryResult,
  enrichment,
  enrichmentSource,
  mode,
  onAllowDeepSeek,
  onDeclineDeepSeek,
  onTranslationAvailable,
  sentenceText,
}: {
  candidate: WordLookupCandidate;
  consent: DeepSeekCloudConsent;
  dictionaryResult: FoundDictionaryResult;
  enrichment: WordLookupAiEnrichment;
  enrichmentSource: LoadedWordLookupAi["source"];
  mode: WordLookupAiMode;
  onAllowDeepSeek: () => void;
  onDeclineDeepSeek: () => void;
  onTranslationAvailable: (translation: AvailableTranslation) => void;
  sentenceText: string;
}) {
  const [showChinese, setShowChinese] = useState(false);
  const [translation, setTranslation] = useState<LoadedWordLookupAi | null>(null);
  const selectedSense = dictionarySenseOptions(dictionaryResult).find(
    (sense) => sense.id === enrichment.senseId,
  );

  useEffect(() => {
    if (!showChinese || !selectedSense) {
      setTranslation(null);
      return;
    }
    const abortController = new AbortController();
    let ignore = false;
    setTranslation(null);
    loadWordLookupAiTranslation(
      candidate,
      sentenceText,
      dictionaryResult,
      selectedSense.id,
      consent === "granted",
      abortController.signal,
    )
      .then((next) => {
        if (ignore) return;
        setTranslation(next);
        if (
          next.response.status === "available" &&
          next.response.task === "translate"
        ) {
          onTranslationAvailable(next.response);
        }
      })
      .catch(() => {
        if (!ignore && !abortController.signal.aborted) {
          setTranslation({
            source: "provider",
            response: {
              status: "unavailable",
              mode: "dictionary-only",
              reason: "provider-failure",
            },
          });
        }
      });
    return () => {
      ignore = true;
      abortController.abort();
    };
  }, [
    candidate,
    consent,
    dictionaryResult,
    onTranslationAvailable,
    selectedSense?.id,
    sentenceText,
    showChinese,
  ]);

  if (!selectedSense) return null;
  const translationResponse =
    translation?.response.status === "available" &&
    translation.response.task === "translate"
      ? translation.response
      : null;
  const translated = translationResponse?.result ?? null;
  const translationUnavailable =
    translation?.response.status === "unavailable"
      ? translation.response.reason
      : null;
  const translationNeedsConsent =
    translationUnavailable === "deepseek-consent-required";
  const providerLabel = mode === "local-ai" ? "LOCAL AI" : "DEEPSEEK";

  return (
    <section
      aria-label={`${mode === "local-ai" ? "Local AI" : "DeepSeek"} 辅助`}
      className={`lookup-ai-panel lookup-ai-panel-${mode}`}
    >
      <header>
        <div>
          <span>{providerLabel} · 辅助</span>
          <strong>AI 生成例句，不是词典原文</strong>
        </div>
        {enrichmentSource === "cache" ? <small>AI 本地缓存</small> : null}
      </header>
      <div className="lookup-ai-block">
        <span>AI 选择的词典义项（词典事实）</span>
        <blockquote>{selectedSense.definition}</blockquote>
      </div>
      <div className="lookup-ai-block">
        <span>AI 辅助例句</span>
        <p>{enrichment.auxiliaryExample}</p>
      </div>
      <label className="lookup-translation-toggle">
        <input
          checked={showChinese}
          onChange={(event) => setShowChinese(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>
          <strong>显示中文释义</strong>
          <small>默认关闭，仅在开启后请求</small>
        </span>
      </label>
      {showChinese && !translation ? (
        <p className="lookup-ai-loading" role="status">
          正在请求中文释义…
        </p>
      ) : null}
      {translated ? (
        <div className="lookup-chinese-meaning">
          <span>
            {translationResponse?.mode === "deepseek"
              ? "DeepSeek 中文释义"
              : "Local AI 中文释义"}
          </span>
          <p>{translated.chineseMeaning}</p>
          {translation?.source === "cache" ? <small>本地缓存</small> : null}
        </div>
      ) : null}
      {translationNeedsConsent && consent === "unknown" ? (
        <DeepSeekConsentPrompt
          onAllow={onAllowDeepSeek}
          onDecline={onDeclineDeepSeek}
        />
      ) : null}
      {translationNeedsConsent && consent === "declined" ? (
        <p className="lookup-ai-notice">已拒绝向 DeepSeek 发送内容</p>
      ) : null}
      {translationUnavailable && !translationNeedsConsent ? (
        <p className="lookup-ai-notice">
          中文释义暂时不可用：{aiUnavailableMessage(translationUnavailable)}
        </p>
      ) : null}
    </section>
  );
}

export function WordLookupDrawer({
  onClose,
  origin,
  request,
}: WordLookupDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const {
    preferences,
    preferenceStatus,
    setDeepSeekCloudConsent,
  } = useStudyLibraryClient();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    value: LoadedWordLookup;
  } | null>(null);
  const [aiLoaded, setAiLoaded] = useState<{
    key: string;
    value: LoadedWordLookupAi;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedEntry, setSavedEntry] = useState<WordBankEntry | null>(null);
  const [wordBankStatus, setWordBankStatus] = useState<
    "idle" | "saving" | "saved" | "removing" | "error"
  >("idle");
  const [translationForSave, setTranslationForSave] = useState<{
    key: string;
    response: AvailableTranslation;
  } | null>(null);
  const candidate = request.candidates[selectedIndex] ?? request.candidates[0];
  const lookupKey = candidate
    ? `${candidate.normalizedForm}\u0000${request.sentenceText}`
    : "missing";
  const dictionaryLoaded = loaded?.key === lookupKey ? loaded.value : null;
  const currentAiLoaded = aiLoaded?.key === lookupKey ? aiLoaded.value : null;
  const preferencesLoading = preferenceStatus === "loading";
  const wordBankEntryId = candidate
    ? wordBankEntryIdFor(origin, candidate)
    : "missing";

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const root = document.documentElement;
    const rootWasLocked = root.classList.contains("word-lookup-modal-open");
    const previousScrollbarWidth = root.style.getPropertyValue(
      "--word-lookup-scrollbar-width",
    );
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const scrollPosition = { left: window.scrollX, top: window.scrollY };
    const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], audio[controls], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    root.style.setProperty(
      "--word-lookup-scrollbar-width",
      `${scrollbarWidth}px`,
    );
    root.classList.add("word-lookup-modal-open");
    if (!dialog.open) dialog.showModal();
    dialog.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      dialog.removeEventListener("keydown", handleKeyDown);
      if (dialog.open) dialog.close();
      if (!rootWasLocked) root.classList.remove("word-lookup-modal-open");
      if (previousScrollbarWidth) {
        root.style.setProperty(
          "--word-lookup-scrollbar-width",
          previousScrollbarWidth,
        );
      } else {
        root.style.removeProperty("--word-lookup-scrollbar-width");
      }
      const previousScrollBehavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      window.scrollTo(scrollPosition);
      root.style.scrollBehavior = previousScrollBehavior;
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    let active = true;
    setSavedEntry(null);
    setWordBankStatus("idle");
    if (!candidate) return;
    readWordBankEntry(wordBankEntryId)
      .then((entry) => {
        if (active) setSavedEntry(entry);
      })
      .catch(() => {
        if (active) setWordBankStatus("error");
      });
    return () => {
      active = false;
    };
  }, [candidate, wordBankEntryId]);

  useEffect(() => {
    if (!candidate) return;
    const abortController = new AbortController();
    let ignore = false;
    setError(null);

    loadWordLookup(candidate, request.sentenceText, abortController.signal)
      .then((next) => {
        if (!ignore) setLoaded({ key: lookupKey, value: next });
      })
      .catch((cause) => {
        if (!ignore && !abortController.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "基础词典暂时不可用，也没有可用缓存",
          );
        }
      });

    return () => {
      ignore = true;
      abortController.abort();
    };
  }, [candidate, lookupKey, request.sentenceText]);

  useEffect(() => {
    if (
      !candidate ||
      dictionaryLoaded?.result.status !== "found" ||
      preferencesLoading
    ) {
      return;
    }
    const abortController = new AbortController();
    let ignore = false;
    setAiLoaded((current) =>
      current?.key === lookupKey ? null : current,
    );
    loadWordLookupAiEnrichment(
      candidate,
      request.sentenceText,
      dictionaryLoaded.result,
      preferences.deepSeekCloudConsent === "granted",
      abortController.signal,
    ).then((next) => {
      if (!ignore) setAiLoaded({ key: lookupKey, value: next });
    }).catch(() => {
      if (!ignore && !abortController.signal.aborted) {
        setAiLoaded({
          key: lookupKey,
          value: {
            source: "provider",
            response: {
              status: "unavailable",
              mode: "dictionary-only",
              reason: "provider-failure",
            },
          },
        });
      }
    });
    return () => {
      ignore = true;
      abortController.abort();
    };
  }, [
    candidate,
    dictionaryLoaded,
    lookupKey,
    preferences.deepSeekCloudConsent,
    preferencesLoading,
    request.sentenceText,
  ]);

  if (!candidate) return null;

  const firstAudio =
    dictionaryLoaded?.result.status === "found"
      ? dictionaryLoaded.result.entries.find((entry) => entry.americanAudio)
          ?.americanAudio
      : undefined;
  const availableAiResponse =
    currentAiLoaded?.response.status === "available" &&
    currentAiLoaded.response.task === "enrich"
      ? currentAiLoaded.response
      : null;
  const unavailableAiReason =
    currentAiLoaded?.response.status === "unavailable"
      ? currentAiLoaded.response.reason
      : null;
  const needsDeepSeekConsent =
    unavailableAiReason === "deepseek-consent-required";
  const allowDeepSeek = () => void setDeepSeekCloudConsent("granted");
  const declineDeepSeek = () => void setDeepSeekCloudConsent("declined");
  const rememberTranslation = useCallback(
    (translation: AvailableTranslation) =>
      setTranslationForSave({ key: lookupKey, response: translation }),
    [lookupKey],
  );
  const draftWordBankEntry =
    dictionaryLoaded?.result.status === "found" &&
    currentAiLoaded &&
    !(
      needsDeepSeekConsent &&
      preferences.deepSeekCloudConsent === "unknown"
    )
      ? createWordBankEntry({
          candidate,
          dictionary: dictionaryLoaded.result,
          enrichment: availableAiResponse ?? undefined,
          origin,
          translation:
            translationForSave?.key === lookupKey
              ? translationForSave.response
              : undefined,
        })
      : null;
  const saveToWordBank = async () => {
    if (!draftWordBankEntry) return;
    setWordBankStatus("saving");
    try {
      await saveWordBankEntry(draftWordBankEntry);
      setSavedEntry(draftWordBankEntry);
      setWordBankStatus("saved");
    } catch {
      setWordBankStatus("error");
    }
  };
  const cancelWordBankSave = async () => {
    if (!savedEntry) return;
    setWordBankStatus("removing");
    try {
      await removeWordBankEntry(savedEntry.id);
      setSavedEntry(null);
      setWordBankStatus("idle");
    } catch {
      setWordBankStatus("error");
    }
  };

  return (
    <dialog
      aria-label={`Word Lookup: ${request.candidates[0].surfaceForm}`}
      aria-modal="true"
      className="word-lookup-dialog word-lookup-drawer"
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        onCloseRef.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
      ref={dialogRef}
    >
      <header className="lookup-header">
        <div>
          <p className="eyebrow">WORD LOOKUP</p>
          <h2>{candidate.surfaceForm}</h2>
        </div>
        <button
          aria-label="关闭 Word Lookup"
          onClick={() => onCloseRef.current()}
          ref={closeButtonRef}
          type="button"
        >
          ×
        </button>
      </header>

      <div className="lookup-mode-row">
        <span>
          {availableAiResponse
            ? availableAiResponse.mode === "local-ai"
              ? "Local AI"
              : "DeepSeek"
            : "Dictionary only"}
        </span>
        <span>Dictionary facts</span>
        {dictionaryLoaded?.source === "cache" ? <span>本地缓存</span> : null}
      </div>

      <div className="lookup-normalization">
        <p>
          原文词形 <strong>{candidate.surfaceForm}</strong>
        </p>
        <p>
          词典形式 <strong>{candidate.normalizedForm}</strong>
        </p>
      </div>

      {request.candidates.length > 1 ? (
        <div className="lookup-candidates" aria-label="候选词条">
          <span>可能的多词表达</span>
          {request.candidates.map((item, index) => (
            <button
              aria-label={
                index === 0
                  ? `查询单词 ${item.normalizedForm}`
                  : `查询候选短语 ${item.normalizedForm}`
              }
              aria-pressed={index === selectedIndex}
              key={`${item.surfaceForm}:${item.normalizedForm}`}
              onClick={() => setSelectedIndex(index)}
              type="button"
            >
              {item.surfaceForm}
              {item.surfaceForm.toLocaleLowerCase("en-US") !==
              item.normalizedForm ? (
                <small>→ {item.normalizedForm}</small>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      <blockquote>{request.sentenceText}</blockquote>

      {!dictionaryLoaded && !error ? (
        <div className="lookup-loading" role="status">
          <span />
          正在查询基础词典…
        </div>
      ) : null}

      {error ? (
        <p className="lookup-error" role="alert">
          {error}
        </p>
      ) : null}

      {dictionaryLoaded?.result.status === "not-found" ? (
        <div className="lookup-empty">
          <h3>基础词典没有收录这个词条</h3>
          <p>可以尝试单词形式、候选短语，或重新选择更短的连续文本。</p>
          <BrowserPronunciation candidate={candidate} />
        </div>
      ) : null}

      {dictionaryLoaded?.result.status === "found" ? (
        <div className="lookup-results">
          {firstAudio ? (
            <DictionaryPronunciation
              audio={firstAudio}
              candidate={candidate}
            />
          ) : (
            <BrowserPronunciation candidate={candidate} />
          )}

          {needsDeepSeekConsent &&
          preferences.deepSeekCloudConsent === "unknown" ? (
            <DeepSeekConsentPrompt
              onAllow={allowDeepSeek}
              onDecline={declineDeepSeek}
            />
          ) : null}

          {needsDeepSeekConsent &&
          preferences.deepSeekCloudConsent === "declined" ? (
            <p className="lookup-ai-notice" role="status">
              已拒绝向 DeepSeek 发送内容
            </p>
          ) : null}

          {unavailableAiReason && !needsDeepSeekConsent ? (
            <p className="lookup-ai-notice" role="status">
              {aiUnavailableMessage(unavailableAiReason)}
            </p>
          ) : null}

          <section
            aria-label={`基础词典事实 ${candidate.normalizedForm}`}
            className="lookup-dictionary-facts"
          >
            {dictionaryLoaded.result.entries
              .slice(0, 2)
              .map((entry, entryIndex) => (
                <div
                  className="lookup-entry"
                  key={`${entry.word}:${entryIndex}`}
                >
                  <div className="lookup-entry-heading">
                    <h3>{entry.word}</h3>
                    {entry.phonetic ? <span>{entry.phonetic}</span> : null}
                  </div>
                  {entry.meanings.map((meaning, meaningIndex) => (
                    <div
                      className="lookup-meaning"
                      key={`${meaning.partOfSpeech}:${meaningIndex}`}
                    >
                      <h4>{meaning.partOfSpeech}</h4>
                      <ol>
                        {meaning.definitions
                          .slice(0, 3)
                          .map((definition, index) => (
                            <li key={`${definition.definition}:${index}`}>
                              <p>{definition.definition}</p>
                              {definition.example ? (
                                <blockquote>{definition.example}</blockquote>
                              ) : null}
                            </li>
                          ))}
                      </ol>
                    </div>
                  ))}
                  {entry.sourceUrls[0] ? (
                    <a
                      href={entry.sourceUrls[0]}
                      rel="noreferrer"
                      target="_blank"
                    >
                      查看词典来源 ↗
                    </a>
                  ) : null}
                </div>
              ))}
          </section>

          {availableAiResponse ? (
            <AiAssistance
              candidate={candidate}
              consent={preferences.deepSeekCloudConsent}
              dictionaryResult={dictionaryLoaded.result}
              enrichment={availableAiResponse.result}
              enrichmentSource={currentAiLoaded?.source ?? "provider"}
              mode={availableAiResponse.mode}
              onAllowDeepSeek={allowDeepSeek}
              onDeclineDeepSeek={declineDeepSeek}
              onTranslationAvailable={rememberTranslation}
              sentenceText={request.sentenceText}
            />
          ) : currentAiLoaded ? null : (
            <p className="lookup-ai-loading" role="status">
              正在获取 Local AI 语境辅助…
            </p>
          )}

          {draftWordBankEntry ? (
            <section
              aria-label="Word Bank 保存"
              className="lookup-word-bank-save"
            >
              <div>
                <strong>
                  {savedEntry ? "已保存到 Word Bank" : "保存这次语境"}
                </strong>
                <small>保留所选词义、原句、Study Video 与时间区间</small>
              </div>
              <button
                disabled={
                  wordBankStatus === "saving" || wordBankStatus === "removing"
                }
                onClick={() =>
                  void (savedEntry ? cancelWordBankSave() : saveToWordBank())
                }
                type="button"
              >
                {wordBankStatus === "saving" ? "正在保存…" : null}
                {wordBankStatus === "removing" ? "正在取消…" : null}
                {wordBankStatus !== "saving" && wordBankStatus !== "removing"
                  ? savedEntry
                    ? "取消保存"
                    : "保存到 Word Bank"
                  : null}
              </button>
              {wordBankStatus === "error" ? (
                <p role="alert">本地数据不可用，Word Bank 未能更新</p>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
