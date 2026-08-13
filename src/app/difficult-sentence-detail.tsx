"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  completeDifficultSentenceAnalysis,
  readDifficultSentence,
  removeDifficultSentence,
  setDifficultSentenceLearningState,
} from "@/client/difficult-sentence-library";
import { generateDifficultSentenceAnalysis } from "@/client/difficult-sentence-analysis-client";
import { readStudyVideo } from "@/client/study-video-library";
import { readDifficultSentenceLibrary } from "@/client/difficult-sentence-library";
import type {
  DifficultSentence,
  DifficultSentenceId,
} from "@/domain/difficult-sentence";
import type { YouTubeVideoId } from "@/domain/study-video";
import { formatMediaTime } from "@/domain/time";
import { createWordLookupRequest, type WordLookupRequest } from "@/domain/word-lookup";

import { useStudyLibraryClient } from "./study-library-client-context";
import {
  YouTubePlayer,
  type YouTubePlayerHandle,
} from "./youtube-player";
import { WordLookupDrawer } from "./word-lookup-drawer";
import { difficultSentenceMatches, type DifficultSentenceFilter } from "./difficult-sentence-library";

type ImportantDraft = {
  start: string;
  text: string;
  contextualMeaning: string;
  informationContribution: string;
  listeningPriority: string;
};
type WeakFormDraft = { start: string; text: string; reducedForm: string; listeningCue: string };

function exactRange(source: string, text: string, requestedStart: string) {
  const needle = text.trim();
  const start = Number(requestedStart);
  if (
    !needle ||
    !Number.isInteger(start) ||
    start < 0 ||
    source.slice(start, start + needle.length) !== needle
  ) {
    throw new Error(`请为原文“${needle || "空内容"}”填写正确的起始字符位置`);
  }
  return { start, end: start + needle.length, text: needle };
}

function AnnotatedSentence({
  item,
  visible,
  onLookup,
}: {
  item: DifficultSentence;
  visible: boolean;
  onLookup: (request: WordLookupRequest) => void;
}) {
  if (!visible || !item.analysis) return <>{item.snapshot.text}</>;
  const important = item.analysis.importantItems;
  const weakForms = item.analysis.weakForms;
  const boundaries = new Set([0, item.snapshot.text.length]);
  [...important, ...weakForms].forEach((entry) => {
    boundaries.add(entry.start);
    boundaries.add(entry.end);
  });
  const ordered = [...boundaries].sort((left, right) => left - right);
  return ordered.slice(0, -1).map((start, index) => {
    const end = ordered[index + 1] ?? start;
    const text = item.snapshot.text.slice(start, end);
    const importantItem = important.find(
      (entry) => start >= entry.start && end <= entry.end,
    );
    const weakItem = weakForms.find(
      (entry) => start >= entry.start && end <= entry.end,
    );
    if (importantItem) {
      return (
        <mark
          data-annotation="important"
          key={`${start}:${end}`}
          onClick={() =>
            document
              .getElementById(`important-${importantItem.start}-${importantItem.end}`)
              ?.focus()
          }
          title={importantItem.contextualMeaning}
        >
          {text}
        </mark>
      );
    }
    return weakItem ? (
      <mark
        data-annotation="weak-form"
        key={`${start}:${end}`}
        onClick={() =>
          document
            .getElementById(`weak-${weakItem.start}-${weakItem.end}`)
            ?.focus()
        }
        title={`${weakItem.reducedForm} · ${weakItem.listeningCue}`}
      >
        {text}
      </mark>
    ) : text;
  });
}

function AnalysisEditor({
  item,
  onCancel,
  onSaved,
}: {
  item: DifficultSentence;
  onCancel: () => void;
  onSaved: (item: DifficultSentence) => void;
}) {
  const [naturalMeaning, setNaturalMeaning] = useState(
    item.analysis?.naturalMeaning ?? "",
  );
  const [listeningSkeleton, setListeningSkeleton] = useState(
    item.analysis?.listeningSkeleton ?? "",
  );
  const [captureOrder, setCaptureOrder] = useState(
    item.analysis?.captureOrder.join("\n") ?? "",
  );
  const [importantItems, setImportantItems] = useState<ImportantDraft[]>(
    item.analysis?.importantItems.map((entry) => ({
      start: String(entry.start),
      text: entry.text,
      contextualMeaning: entry.contextualMeaning,
      informationContribution: entry.informationContribution,
      listeningPriority: entry.listeningPriority,
    })) ?? [],
  );
  const [weakForms, setWeakForms] = useState<WeakFormDraft[]>(
    item.analysis?.weakForms.map((entry) => ({
      start: String(entry.start),
      text: entry.text,
      reducedForm: entry.reducedForm,
      listeningCue: entry.listeningCue,
    })) ?? [],
  );
  const [error, setError] = useState<string | null>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const updated = await completeDifficultSentenceAnalysis({
        id: item.id,
        provenance: item.analysis ? "edited" : "manual",
        analysis: {
          naturalMeaning,
          listeningSkeleton,
          captureOrder: captureOrder
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
          importantItems: importantItems.map((entry) => ({
            ...exactRange(item.snapshot.text, entry.text, entry.start),
            contextualMeaning: entry.contextualMeaning,
            informationContribution: entry.informationContribution,
            listeningPriority: entry.listeningPriority,
          })),
          weakForms: weakForms.map((entry) => ({
            ...exactRange(item.snapshot.text, entry.text, entry.start),
            reducedForm: entry.reducedForm,
            listeningCue: entry.listeningCue,
          })),
        },
      });
      if (!updated) throw new Error("找不到这个 Difficult Sentence");
      onSaved(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "解析未能保存");
    }
  };

  return (
    <form className="difficult-analysis-editor" onSubmit={(event) => void save(event)}>
      <label>
        <span>整句中文含义</span>
        <textarea
          onChange={(event) => setNaturalMeaning(event.currentTarget.value)}
          required
          value={naturalMeaning}
        />
      </label>
      <fieldset>
        <legend>重点内容（按句意添加，不限数量，可为空）</legend>
        {importantItems.map((entry, index) => (
          <div className="analysis-item-editor" key={index}>
            <label><span>原句中的词或短语</span><input aria-label={`重点原文 ${index + 1}`} onChange={(event) => { const value = event.currentTarget.value; const start = item.snapshot.text.indexOf(value.trim()); setImportantItems((items) => items.map((draft, itemIndex) => itemIndex === index ? { ...draft, text: value, start: start >= 0 ? String(start) : "" } : draft)); }} required value={entry.text} /></label>
            <label><span>起始字符位置</span><input aria-label={`重点起始位置 ${index + 1}`} min="0" onChange={(event) => { const value = event.currentTarget.value; setImportantItems((items) => items.map((draft, itemIndex) => itemIndex === index ? { ...draft, start: value } : draft)); }} required type="number" value={entry.start} /></label>
            <label><span>语境含义</span><input aria-label={`语境含义 ${index + 1}`} onChange={(event) => { const value = event.currentTarget.value; setImportantItems((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, contextualMeaning: value } : item)); }} required value={entry.contextualMeaning} /></label>
            <label><span>信息作用</span><input aria-label={`信息作用 ${index + 1}`} onChange={(event) => { const value = event.currentTarget.value; setImportantItems((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, informationContribution: value } : item)); }} required value={entry.informationContribution} /></label>
            <label><span>听力优先级</span><input aria-label={`听力优先级 ${index + 1}`} onChange={(event) => { const value = event.currentTarget.value; setImportantItems((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, listeningPriority: value } : item)); }} required value={entry.listeningPriority} /></label>
            <button aria-label={`删除重点内容 ${index + 1}`} onClick={() => setImportantItems((items) => items.filter((_, itemIndex) => itemIndex !== index))} type="button">删除</button>
          </div>
        ))}
        <button onClick={() => setImportantItems((items) => [...items, { start: "", text: "", contextualMeaning: "", informationContribution: "", listeningPriority: "" }])} type="button">添加重点内容</button>
      </fieldset>
      <fieldset>
        <legend>弱读预测（文本推测，可为空）</legend>
        {weakForms.map((entry, index) => (
          <div className="analysis-item-editor" key={index}>
            <label><span>原句中的功能词</span><input aria-label={`弱读原文 ${index + 1}`} onChange={(event) => { const value = event.currentTarget.value; const start = item.snapshot.text.indexOf(value.trim()); setWeakForms((items) => items.map((draft, itemIndex) => itemIndex === index ? { ...draft, text: value, start: start >= 0 ? String(start) : "" } : draft)); }} required value={entry.text} /></label>
            <label><span>起始字符位置</span><input aria-label={`弱读起始位置 ${index + 1}`} min="0" onChange={(event) => { const value = event.currentTarget.value; setWeakForms((items) => items.map((draft, itemIndex) => itemIndex === index ? { ...draft, start: value } : draft)); }} required type="number" value={entry.start} /></label>
            <label><span>可能读音</span><input aria-label={`可能读音 ${index + 1}`} onChange={(event) => { const value = event.currentTarget.value; setWeakForms((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, reducedForm: value } : item)); }} required value={entry.reducedForm} /></label>
            <label><span>听力提示</span><input aria-label={`弱读听力提示 ${index + 1}`} onChange={(event) => { const value = event.currentTarget.value; setWeakForms((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, listeningCue: value } : item)); }} required value={entry.listeningCue} /></label>
            <button aria-label={`删除弱读预测 ${index + 1}`} onClick={() => setWeakForms((items) => items.filter((_, itemIndex) => itemIndex !== index))} type="button">删除</button>
          </div>
        ))}
        <button onClick={() => setWeakForms((items) => [...items, { start: "", text: "", reducedForm: "", listeningCue: "" }])} type="button">添加弱读预测</button>
      </fieldset>
      <label>
        <span>实用听力结构</span>
        <textarea
          onChange={(event) => setListeningSkeleton(event.currentTarget.value)}
          required
          value={listeningSkeleton}
        />
      </label>
      <label>
        <span>听力捕捉顺序</span>
        <textarea
          onChange={(event) => setCaptureOrder(event.currentTarget.value)}
          placeholder="每行一个捕捉步骤"
          required
          value={captureOrder}
        />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <div>
        <button onClick={onCancel} type="button">取消</button>
        <button type="submit">保存手动解析</button>
      </div>
    </form>
  );
}

function AnalysisView({
  item,
  onLookup,
}: {
  item: DifficultSentence;
  onLookup: (request: WordLookupRequest) => void;
}) {
  const analysis = item.analysis;
  if (!analysis) return null;
  return (
    <section className="difficult-analysis" aria-label="难句解析内容">
      <div>
        <p className="eyebrow">NATURAL MEANING</p>
        <h2>整句含义</h2>
        <p>{analysis.naturalMeaning}</p>
      </div>
      {analysis.importantItems.length > 0 ? (
        <div>
          <p className="eyebrow">IMPORTANT CONTENT</p>
          <h2>重点内容</h2>
          <ul>
            {analysis.importantItems.map((entry) => (
              <li id={`important-${entry.start}-${entry.end}`} key={`${entry.start}:${entry.end}`} tabIndex={-1}>
                <button
                  className="important-lookup-button"
                  onClick={() =>
                    onLookup(
                      createWordLookupRequest(
                        item.snapshot.learningSentenceId,
                        item.snapshot.text,
                        entry.text,
                        entry.start,
                      ),
                    )
                  }
                  type="button"
                >{entry.text}</button> — {entry.contextualMeaning}；
                {entry.informationContribution}；{entry.listeningPriority}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {analysis.weakForms.length > 0 ? (
        <div>
          <p className="eyebrow">WEAK-FORM PREDICTIONS</p>
          <h2>弱读预测</h2>
          <p className="weak-form-disclaimer">
            文本预测，请回到原视频核对；这不是声音分析结果。
          </p>
          <ul>
            {analysis.weakForms.map((entry) => (
              <li id={`weak-${entry.start}-${entry.end}`} key={`${entry.start}:${entry.end}`} tabIndex={-1}>
                <strong>{entry.text}</strong> <span>{entry.reducedForm}</span> — {entry.listeningCue}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <p className="eyebrow">LISTENING SKELETON</p>
        <h2>听力结构</h2>
        <p>{analysis.listeningSkeleton}</p>
      </div>
      <div>
        <p className="eyebrow">CAPTURE ORDER</p>
        <h2>捕捉顺序</h2>
        <ol>{analysis.captureOrder.map((step, index) => <li key={`${index}:${step}`}>{step}</li>)}</ol>
      </div>
    </section>
  );
}

export function DifficultSentenceDetail({
  difficultSentenceId,
  initialFilter,
  initialQuery,
  startGeneration,
}: {
  difficultSentenceId: DifficultSentenceId;
  initialFilter: DifficultSentenceFilter;
  initialQuery: string;
  startGeneration: boolean;
}) {
  const router = useRouter();
  const {
    networkStatus,
    preferences,
    setDeepSeekCloudConsent,
  } = useStudyLibraryClient();
  const playerRef = useRef<YouTubePlayerHandle>(null);
  const [item, setItem] = useState<DifficultSentence | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [looping, setLooping] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [supportedRates, setSupportedRates] = useState<number[]>([]);
  const [annotationsVisible, setAnnotationsVisible] = useState(true);
  const [wordLookupRequest, setWordLookupRequest] =
    useState<WordLookupRequest | null>(null);
  const [sourceAvailable, setSourceAvailable] = useState(false);
  const [sourceAvailabilityLoaded, setSourceAvailabilityLoaded] = useState(false);
  const [playbackVideoId, setPlaybackVideoId] = useState<YouTubeVideoId | undefined>();
  const [generationReason, setGenerationReason] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [resultItems, setResultItems] = useState<DifficultSentence[]>([]);
  const initialGenerationStarted = useRef(false);

  useEffect(() => {
    let active = true;
    setLoaded(false);
    setItem(null);
    setSourceAvailable(false);
    setSourceAvailabilityLoaded(false);
    setPlaybackVideoId(undefined);
    readDifficultSentence(difficultSentenceId)
      .then((stored) => {
        if (!active) return;
        setItem(stored);
        if (stored) {
          void readStudyVideo(stored.origin.studyVideoId).then((video) => {
            if (active) {
              setSourceAvailable(Boolean(video));
              setPlaybackVideoId(video?.youtubeVideoId);
              setSourceAvailabilityLoaded(true);
            }
          }).catch(() => {
            if (active) setSourceAvailabilityLoaded(true);
          });
          void readDifficultSentenceLibrary().then((library) => {
            if (active) {
              setResultItems(
                library.filter((entry) =>
                  difficultSentenceMatches(entry, initialQuery, initialFilter),
                ),
              );
            }
          });
        }
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => { active = false; };
  }, [difficultSentenceId, initialFilter, initialQuery]);

  const generate = async (
    current: DifficultSentence,
    confirmOverwrite: boolean,
    allowDeepSeek = preferences.deepSeekCloudConsent === "granted",
  ) => {
    if (confirmOverwrite) {
      const warning = current.provenance === "manual" || current.provenance === "edited"
        ? "这会覆盖你手动填写或修改的解析。确定重新生成吗？"
        : "这会替换当前解析。确定重新生成吗？";
      if (!window.confirm(warning)) return;
    }
    setGenerating(true);
    setGenerationReason(null);
    try {
      const response = await generateDifficultSentenceAnalysis(
        current,
        allowDeepSeek,
      );
      if (response.status === "available") {
        const updated = await readDifficultSentence(current.id);
        if (updated && current.id === difficultSentenceId) setItem(updated);
      } else {
        setGenerationReason(response.reason);
      }
    } catch {
      setGenerationReason("provider-failure");
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (
      !item ||
      !startGeneration ||
      initialGenerationStarted.current ||
      item.analysis
    ) {
      return;
    }
    initialGenerationStarted.current = true;
    window.history.replaceState(
      null,
      "",
      `/difficult-sentences/${encodeURIComponent(item.id)}?query=${encodeURIComponent(initialQuery)}&status=${initialFilter}`,
    );
    if (networkStatus === "online") {
      void generate(item, false);
    } else {
      setGenerationReason("provider-failure");
    }
  }, [initialFilter, initialQuery, item, networkStatus, startGeneration]);

  if (!loaded) {
    return <main className="difficult-sentence-page" id="main-content">正在打开 Difficult Sentence…</main>;
  }
  if (!item) {
    return (
      <main className="difficult-sentence-page" id="main-content">
        <h1>找不到这个 Difficult Sentence</h1>
        <Link href="/">返回学习库</Link>
      </main>
    );
  }

  const stateLabel = item.learningState === "mastered"
    ? "Mastered"
    : item.analysis
      ? "Learning"
      : "Pending analysis";
  const provenanceLabel = item.provenance === "manual"
    ? "Manual analysis"
    : item.provenance === "edited"
      ? "Edited"
      : item.provenance === "ai"
        ? "AI analysis"
        : null;
  const playSentence = () => {
    const interval = {
      startSeconds: item.snapshot.startSeconds,
      endSeconds: item.snapshot.endSeconds,
    };
    if (looping) {
      playerRef.current?.setRepeatInterval(interval);
      playerRef.current?.playFrom(item.snapshot.startSeconds);
    } else {
      playerRef.current?.playInterval(interval);
    }
  };
  const toggleLoop = () => {
    const next = !looping;
    setLooping(next);
    playerRef.current?.setRepeatInterval(
      next
        ? { startSeconds: item.snapshot.startSeconds, endSeconds: item.snapshot.endSeconds }
        : null,
    );
  };
  const toggleMastery = async () => {
    const updated = await setDifficultSentenceLearningState(
      item.id,
      item.learningState === "mastered" ? "learning" : "mastered",
    );
    if (updated) setItem(updated);
  };
  const resultIndex = resultItems.findIndex((entry) => entry.id === item.id);
  const resultQuery = `?query=${encodeURIComponent(initialQuery)}&status=${initialFilter}`;
  const showDeepSeekConsent =
    generationReason === "deepseek-consent-required" &&
    preferences.deepSeekCloudConsent === "unknown";
  const deepSeekConsentPanel = showDeepSeekConsent ? (
    <div className="difficult-cloud-consent">
      <h3>允许使用 DeepSeek 云端回退？</h3>
      <p>
        Local AI 当前不可用。若继续，当前句、上一句、下一句和当前时间范围会发送到
        DeepSeek；不会发送完整字幕、学习库或 Word Bank。
      </p>
      <button
        disabled={networkStatus !== "online"}
        onClick={() => {
          void setDeepSeekCloudConsent("declined");
          setGenerationReason("deepseek-consent-required");
        }}
        type="button"
      >不同意</button>
      <button
        disabled={networkStatus !== "online"}
        onClick={() => {
          void setDeepSeekCloudConsent("granted").then(() =>
            generate(item, false, true),
          );
        }}
        type="button"
      >同意并使用 DeepSeek</button>
    </div>
  ) : null;
  const generationUnavailable = generationReason && !showDeepSeekConsent ? (
    <p role="status">
      自动解析暂时不可用，{item.analysis ? "已保留原解析。" : "已保留 Pending analysis。"}
    </p>
  ) : null;

  return (
    <main className="difficult-sentence-page" id="main-content">
      <header className="difficult-sentence-header">
        <div><p className="eyebrow">DIFFICULT SENTENCE</p><h1>难句解析</h1></div>
        <div className="difficult-sentence-state">
          <span className="difficult-sentence-status">{stateLabel}</span>
          {provenanceLabel ? <span>{provenanceLabel}</span> : null}
        </div>
      </header>
      {resultIndex >= 0 ? (
        <nav className="difficult-result-navigation" aria-label="难句结果导航">
          {resultItems[resultIndex - 1] ? (
            <Link href={`/difficult-sentences/${encodeURIComponent(resultItems[resultIndex - 1].id)}${resultQuery}`}>上一句</Link>
          ) : <span />}
          <strong>{resultIndex + 1} / {resultItems.length}</strong>
          {resultItems[resultIndex + 1] ? (
            <Link href={`/difficult-sentences/${encodeURIComponent(resultItems[resultIndex + 1].id)}${resultQuery}`}>下一句</Link>
          ) : <span />}
        </nav>
      ) : null}

      <section className="difficult-sentence-player" aria-label="原视频语音">
        {networkStatus === "online" && sourceAvailable && playbackVideoId ? (
          <YouTubePlayer
            className="study-player"
            initialPositionSeconds={0}
            onPlaybackRateChange={setPlaybackRate}
            onPlaybackRatesChange={setSupportedRates}
            ref={playerRef}
            videoId={playbackVideoId}
          />
        ) : (
          <div className="study-player study-player-offline">当前无法播放原视频</div>
        )}
        <div className="difficult-playback-controls">
          <button disabled={networkStatus !== "online" || !sourceAvailable} onClick={playSentence} type="button">播放句子</button>
          <button disabled={networkStatus !== "online" || !sourceAvailable} onClick={() => playerRef.current?.pause()} type="button">暂停</button>
          <button aria-pressed={looping} disabled={networkStatus !== "online" || !sourceAvailable} onClick={toggleLoop} type="button">句子循环</button>
          {[0.75, 1].map((rate) => (
            <button
              aria-pressed={playbackRate === rate}
              disabled={networkStatus !== "online" || !sourceAvailable || !supportedRates.includes(rate)}
              key={rate}
              onClick={() => playerRef.current?.setPlaybackRate(rate)}
              type="button"
            >{rate}x</button>
          ))}
        </div>
      </section>

      <section className="difficult-sentence-snapshot">
        <p>
          <AnnotatedSentence
            item={item}
            onLookup={setWordLookupRequest}
            visible={annotationsVisible}
          />
        </p>
        {item.analysis &&
        (item.analysis.importantItems.length > 0 ||
          item.analysis.weakForms.length > 0) ? (
          <div className="annotation-controls">
            <span><i className="legend-important" />重点内容</span>
            <span><i className="legend-weak" />弱读预测</span>
            <button onClick={() => setAnnotationsVisible((value) => !value)} type="button">
              {annotationsVisible ? "隐藏听力标注" : "显示听力标注"}
            </button>
          </div>
        ) : null}
        <div>
          <span>{item.origin.studyVideoTitle}</span>
          <span>{formatMediaTime(item.snapshot.startSeconds)}–{formatMediaTime(item.snapshot.endSeconds)}</span>
        </div>
      </section>

      {editing ? (
        <AnalysisEditor
          item={item}
          onCancel={() => setEditing(false)}
          onSaved={(updated) => { setItem(updated); setEditing(false); }}
        />
      ) : item.analysis ? (
        <>
          <AnalysisView item={item} onLookup={setWordLookupRequest} />
          <div className="difficult-analysis-actions">
            <button onClick={() => setEditing(true)} type="button">编辑解析</button>
            <button disabled={generating || networkStatus !== "online"} onClick={() => void generate(item, true)} type="button">{generating ? "正在生成…" : "重新生成"}</button>
            <button onClick={() => void toggleMastery()} type="button">
              {item.learningState === "mastered" ? "改回 Learning" : "标记为 Mastered"}
            </button>
          </div>
          {deepSeekConsentPanel}
          {generationUnavailable}
        </>
      ) : (
        <section className="pending-analysis-card" aria-labelledby="pending-title">
          <p className="eyebrow">SAVED LOCALLY</p>
          <h2 id="pending-title">等待难句解析</h2>
          <p>句子快照和原视频时间范围已经保存。AI 不可用时也不会丢失，可稍后重试或手动填写。</p>
          {deepSeekConsentPanel}
          {generationUnavailable}
          <button disabled={generating || networkStatus !== "online"} onClick={() => void generate(item, false)} type="button">{generating ? "正在生成…" : "重试生成"}</button>
          <button onClick={() => setEditing(true)} type="button">手动填写解析</button>
        </section>
      )}

      {sourceAvailabilityLoaded && sourceAvailable ? <Link
        className="difficult-sentence-back-link"
        href={`/study/${encodeURIComponent(item.origin.studyVideoId)}?sentenceId=${encodeURIComponent(item.snapshot.learningSentenceId)}`}
      >返回 Study Video</Link> : sourceAvailabilityLoaded ? <p className="difficult-source-unavailable">来源 Study Video 已不在学习库，解析仍可继续使用。</p> : null}
      <button
        className="delete-difficult-sentence"
        onClick={() => {
          if (!window.confirm("删除这个 Difficult Sentence？原 Learning Sentence 不会改变。")) return;
          void removeDifficultSentence(item.id).then(() => router.push("/difficult-sentences"));
        }}
        type="button"
      >删除 Difficult Sentence</button>
      {wordLookupRequest ? (
        <WordLookupDrawer
          key={`${wordLookupRequest.sentenceId}:${wordLookupRequest.candidates[0]?.surfaceForm}`}
          onClose={() => setWordLookupRequest(null)}
          origin={{
            studyVideoId: item.origin.studyVideoId,
            studyVideoTitle: item.origin.studyVideoTitle,
            studyVideoChannel: item.origin.studyVideoChannel,
            studyVideoThumbnailUrl: item.origin.studyVideoThumbnailUrl,
            learningSentenceId: item.snapshot.learningSentenceId,
            sentenceText: item.snapshot.text,
            startSeconds: item.snapshot.startSeconds,
            endSeconds: item.snapshot.endSeconds,
          }}
          request={wordLookupRequest}
        />
      ) : null}
    </main>
  );
}
