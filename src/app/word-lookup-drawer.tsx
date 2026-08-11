"use client";

import { useEffect, useState } from "react";

import { loadWordLookup, type LoadedWordLookup } from "@/client/word-lookup-client";
import type {
  DictionaryAudio,
  WordLookupCandidate,
  WordLookupRequest,
} from "@/domain/word-lookup";

type WordLookupDrawerProps = {
  onClose: () => void;
  request: WordLookupRequest;
};

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

export function WordLookupDrawer({
  onClose,
  request,
}: WordLookupDrawerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loaded, setLoaded] = useState<LoadedWordLookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const candidate = request.candidates[selectedIndex] ?? request.candidates[0];

  useEffect(() => {
    if (!candidate) return;
    const abortController = new AbortController();
    let ignore = false;
    setLoaded(null);
    setError(null);

    loadWordLookup(
      candidate,
      request.sentenceText,
      abortController.signal,
    )
      .then((next) => {
        if (!ignore) setLoaded(next);
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
  }, [candidate, request.sentenceText]);

  if (!candidate) return null;

  const firstAudio =
    loaded?.result.status === "found"
      ? loaded.result.entries.find((entry) => entry.americanAudio)
          ?.americanAudio
      : undefined;

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
        <span>Dictionary only</span>
        {loaded?.source === "cache" ? <span>本地缓存</span> : null}
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

      {!loaded && !error ? (
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

      {loaded?.result.status === "not-found" ? (
        <div className="lookup-empty">
          <h3>基础词典没有收录这个词条</h3>
          <p>可以尝试单词形式、候选短语，或重新选择更短的连续文本。</p>
          <BrowserPronunciation candidate={candidate} />
        </div>
      ) : null}

      {loaded?.result.status === "found" ? (
        <div className="lookup-results">
          {firstAudio ? (
            <DictionaryPronunciation audio={firstAudio} candidate={candidate} />
          ) : (
            <BrowserPronunciation candidate={candidate} />
          )}
          {loaded.result.entries.slice(0, 2).map((entry, entryIndex) => (
            <section key={`${entry.word}:${entryIndex}`}>
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
                    {meaning.definitions.slice(0, 3).map((definition, index) => (
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
                <a href={entry.sourceUrls[0]} rel="noreferrer" target="_blank">
                  查看词典来源 ↗
                </a>
              ) : null}
            </section>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
