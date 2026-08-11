"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { readStudyLibrary } from "@/client/study-video-library";
import { readWordBank, removeWordBankEntry } from "@/client/word-bank";
import {
  selectedWordBankDictionaryEntry,
  selectedWordBankSense,
  type WordBankEntry,
} from "@/domain/word-bank";
import { formatMediaTime } from "@/domain/time";

function BrowserWordBankPronunciation({ entry }: { entry: WordBankEntry }) {
  const [error, setError] = useState(false);
  const speak = () => {
    if (
      typeof window.speechSynthesis === "undefined" ||
      typeof window.SpeechSynthesisUtterance === "undefined"
    ) {
      setError(true);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(entry.expression.normalizedForm);
    utterance.lang = "en-US";
    window.speechSynthesis.speak(utterance);
    setError(false);
  };
  return (
    <div className="word-bank-pronunciation">
      <button
        aria-label={`使用浏览器美式发音朗读 ${entry.expression.normalizedForm}`}
        onClick={speak}
        type="button"
      >
        朗读 <span>浏览器 en-US</span>
      </button>
      {error ? <small role="alert">当前浏览器不支持美式语音合成</small> : null}
    </div>
  );
}

function WordBankCard({
  entry,
  onRemove,
  sourceExists,
}: {
  entry: WordBankEntry;
  onRemove: (id: string) => Promise<void>;
  sourceExists: boolean;
}) {
  const [showChinese, setShowChinese] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeFailed, setRemoveFailed] = useState(false);
  const selectedSense = selectedWordBankSense(entry);
  const dictionaryEntry = selectedWordBankDictionaryEntry(entry);
  const audio = dictionaryEntry?.americanAudio ?? entry.lookup.dictionary.entries.find(
    (item) => item.americanAudio,
  )?.americanAudio;
  const translation = entry.lookup.translation?.result.chineseMeaning;
  const returnUrl = `/study/${encodeURIComponent(entry.origin.studyVideoId)}?sentenceId=${encodeURIComponent(entry.origin.learningSentenceId)}&play=1`;

  const remove = async () => {
    setRemoving(true);
    setRemoveFailed(false);
    try {
      await onRemove(entry.id);
    } catch {
      setRemoving(false);
      setRemoveFailed(true);
    }
  };

  return (
    <article
      aria-label={`Word Bank: ${entry.expression.normalizedForm} — ${entry.origin.sentenceText}`}
      className="word-bank-card"
    >
      <header>
        <div>
          <p>{entry.expression.surfaceForm}</p>
          <h3>{entry.expression.normalizedForm}</h3>
          {dictionaryEntry?.phonetic ? <span>{dictionaryEntry.phonetic}</span> : null}
        </div>
        <button
          aria-label={`从 Word Bank 移除 ${entry.expression.normalizedForm}`}
          disabled={removing}
          onClick={() => void remove()}
          type="button"
        >
          {removing ? "正在移除…" : "移除"}
        </button>
      </header>

      {selectedSense ? (
        <section className="word-bank-meaning" aria-label="所选语境词义">
          <span>{selectedSense.partOfSpeech}</span>
          <p>{selectedSense.definition}</p>
        </section>
      ) : null}

      {entry.lookup.enrichment ? (
        <section className="word-bank-example" aria-label="AI 辅助例句">
          <span>
            {entry.lookup.enrichment.mode === "local-ai" ? "LOCAL AI" : "DEEPSEEK"}
            · 辅助例句
          </span>
          <p>{entry.lookup.enrichment.result.auxiliaryExample}</p>
        </section>
      ) : null}

      {audio ? (
        <div className="word-bank-pronunciation">
          <audio
            aria-label={`Word Bank 美式发音 ${entry.expression.normalizedForm}`}
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
      ) : (
        <BrowserWordBankPronunciation entry={entry} />
      )}

      <label className="word-bank-chinese-toggle">
        <input
          checked={showChinese}
          onChange={(event) => setShowChinese(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>
          <strong>显示 {entry.expression.normalizedForm} 的中文释义</strong>
          <small>默认关闭</small>
        </span>
      </label>
      {showChinese ? (
        translation ? (
          <p className="word-bank-chinese">{translation}</p>
        ) : (
          <p className="word-bank-chinese-missing">保存时未包含中文释义</p>
        )
      ) : null}

      <section className="word-bank-origin" aria-label="来源语境">
        <span>
          {formatMediaTime(entry.origin.startSeconds)}–
          {formatMediaTime(entry.origin.endSeconds)}
        </span>
        <blockquote>{entry.origin.sentenceText}</blockquote>
        <p>
          {entry.origin.studyVideoTitle} · {entry.origin.studyVideoChannel}
        </p>
        {sourceExists ? (
          <Link href={returnUrl}>回到原句并播放</Link>
        ) : (
          <small>来源 Study Video 已不在学习库；原句仍保留在 Word Bank</small>
        )}
      </section>
      {removeFailed ? <p role="alert">本地数据不可用，未能移除</p> : null}
    </article>
  );
}

export function WordBankList() {
  const [entries, setEntries] = useState<WordBankEntry[] | null>(null);
  const [sourceIds, setSourceIds] = useState<Set<string>>(new Set());
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([readWordBank(), readStudyLibrary().catch(() => [])])
      .then(([storedEntries, studyVideos]) => {
        if (!active) return;
        setEntries(storedEntries);
        setSourceIds(new Set(studyVideos.map((studyVideo) => studyVideo.id)));
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const remove = async (id: string) => {
    await removeWordBankEntry(id);
    setEntries((current) => current?.filter((entry) => entry.id !== id) ?? []);
  };

  return (
    <section className="word-bank-section" aria-labelledby="word-bank-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">CONTEXTUAL VOCABULARY</p>
          <h2 id="word-bank-title">Word Bank</h2>
        </div>
        <span className="count-label">{entries?.length ?? 0} 个语境词条</span>
      </div>

      {loadFailed ? (
        <p className="library-load-error" role="alert">
          无法读取本地 Word Bank，请检查 Chrome 的网站数据权限。
        </p>
      ) : null}
      {entries === null && !loadFailed ? (
        <p className="word-bank-loading" role="status">
          正在读取 Word Bank…
        </p>
      ) : null}
      {entries?.length === 0 ? (
        <div className="word-bank-empty">
          <h3>还没有保存 Word Lookup</h3>
          <p>在学习页打开一个有用的语境词义，再把它保存到这里。</p>
        </div>
      ) : null}
      {entries && entries.length > 0 ? (
        <div className="word-bank-grid">
          {entries.map((entry) => (
            <WordBankCard
              entry={entry}
              key={entry.id}
              onRemove={remove}
              sourceExists={sourceIds.has(entry.origin.studyVideoId)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
