"use client";

import { useEffect, useState } from "react";

import {
  loadWordLookupAiEnrichment,
  loadWordLookupAiTranslation,
  type LoadedWordLookupAi,
} from "@/client/word-lookup-ai-client";
import { loadWordLookup, type LoadedWordLookup } from "@/client/word-lookup-client";
import {
  dictionarySenseOptions,
  type WordLookupAiEnrichment,
  type WordLookupAiUnavailableReason,
} from "@/domain/word-lookup-ai";
import type {
  DictionaryAudio,
  DictionaryLookupResult,
  WordLookupCandidate,
  WordLookupRequest,
} from "@/domain/word-lookup";

type WordLookupDrawerProps = {
  onClose: () => void;
  request: WordLookupRequest;
};

type FoundDictionaryResult = Extract<
  DictionaryLookupResult,
  { status: "found" }
>;

function aiUnavailableMessage(reason: WordLookupAiUnavailableReason) {
  switch (reason) {
    case "not-configured":
      return "本地 AI 未配置，当前使用基础词典";
    case "timeout":
      return "本地 AI 响应超时，已保留基础词典结果";
    case "invalid-output":
      return "本地 AI 返回格式无效，已保留基础词典结果";
    case "provider-failure":
      return "本地 AI 暂时不可用，已保留基础词典结果";
  }
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
  return (
    <div className="lookup-pronunciation dictionary-audio">
      <span>已确认的美式词典音频</span>
      <audio
        aria-label={`美式发音 ${candidate.normalizedForm}`}
        controls
        preload="none"
        src={audio.url}
      />
      {audio.license ? (
        <a href={audio.license.url} rel="noreferrer" target="_blank">
          音频许可 {audio.license.name}
        </a>
      ) : null}
    </div>
  );
}

function LocalAiAssistance({
  candidate,
  dictionaryResult,
  enrichment,
  enrichmentSource,
  sentenceText,
}: {
  candidate: WordLookupCandidate;
  dictionaryResult: FoundDictionaryResult;
  enrichment: WordLookupAiEnrichment;
  enrichmentSource: LoadedWordLookupAi["source"];
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
      abortController.signal,
    ).then((next) => {
      if (!ignore) setTranslation(next);
    }).catch(() => {
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
    dictionaryResult,
    selectedSense?.id,
    sentenceText,
    showChinese,
  ]);

  if (!selectedSense) return null;
  const translated =
    translation?.response.status === "available" &&
    translation.response.task === "translate"
      ? translation.response.result
      : null;
  const translationUnavailable =
    translation?.response.status === "unavailable"
      ? translation.response.reason
      : null;

  return (
    <section aria-label="Local AI 辅助" className="lookup-ai-panel">
      <header>
        <div>
          <span>LOCAL AI · 辅助</span>
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
          <span>AI 中文释义</span>
          <p>{translated.chineseMeaning}</p>
          {translation?.source === "cache" ? <small>本地缓存</small> : null}
        </div>
      ) : null}
      {translationUnavailable ? (
        <p className="lookup-ai-notice">
          中文释义暂时不可用：{aiUnavailableMessage(translationUnavailable)}
        </p>
      ) : null}
    </section>
  );
}

export function WordLookupDrawer({
  onClose,
  request,
}: WordLookupDrawerProps) {
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
  const candidate = request.candidates[selectedIndex] ?? request.candidates[0];
  const lookupKey = candidate
    ? `${candidate.normalizedForm}\u0000${request.sentenceText}`
    : "missing";
  const dictionaryLoaded = loaded?.key === lookupKey ? loaded.value : null;
  const currentAiLoaded = aiLoaded?.key === lookupKey ? aiLoaded.value : null;

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
    if (!candidate || dictionaryLoaded?.result.status !== "found") return;
    const abortController = new AbortController();
    let ignore = false;
    loadWordLookupAiEnrichment(
      candidate,
      request.sentenceText,
      dictionaryLoaded.result,
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
  }, [candidate, dictionaryLoaded, lookupKey, request.sentenceText]);

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

  return (
    <aside
      aria-label={`Word Lookup: ${request.candidates[0].surfaceForm}`}
      className="word-lookup-drawer"
    >
      <header className="lookup-header">
        <div>
          <p className="eyebrow">WORD LOOKUP</p>
          <h2>{candidate.surfaceForm}</h2>
        </div>
        <button aria-label="关闭 Word Lookup" onClick={onClose} type="button">
          ×
        </button>
      </header>

      <div className="lookup-mode-row">
        <span>{availableAiResponse ? "Local AI" : "Dictionary only"}</span>
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
            <DictionaryPronunciation audio={firstAudio} candidate={candidate} />
          ) : (
            <BrowserPronunciation candidate={candidate} />
          )}

          {unavailableAiReason ? (
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
                <div className="lookup-entry" key={`${entry.word}:${entryIndex}`}>
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
            <LocalAiAssistance
              candidate={candidate}
              dictionaryResult={dictionaryLoaded.result}
              enrichment={availableAiResponse.result}
              enrichmentSource={currentAiLoaded?.source ?? "provider"}
              sentenceText={request.sentenceText}
            />
          ) : currentAiLoaded ? null : (
            <p className="lookup-ai-loading" role="status">
              正在获取 Local AI 语境辅助…
            </p>
          )}
        </div>
      ) : null}
    </aside>
  );
}
