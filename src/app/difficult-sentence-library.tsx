"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { readDifficultSentenceLibrary } from "@/client/difficult-sentence-library";
import { LOCAL_LEARNING_DATA_CHANGED_EVENT } from "@/client/local-learning-data-events";
import { readStudyLibrary } from "@/client/study-video-library";
import type { DifficultSentence } from "@/domain/difficult-sentence";
import { formatMediaTime } from "@/domain/time";

export type DifficultSentenceFilter = "all" | "pending" | "learning" | "mastered";

export function difficultSentenceMatches(
  item: DifficultSentence,
  query: string,
  filter: DifficultSentenceFilter,
) {
  const state = item.analysis ? item.learningState ?? "learning" : "pending";
  if (filter !== "all" && state !== filter) return false;
  const normalized = query.trim().toLocaleLowerCase("en-US");
  if (!normalized) return true;
  return [
    item.snapshot.text,
    item.origin.studyVideoTitle,
    ...(item.analysis?.importantItems.map((entry) => entry.text) ?? []),
  ].some((text) => text.toLocaleLowerCase("en-US").includes(normalized));
}

function useDifficultSentenceData() {
  const [items, setItems] = useState<DifficultSentence[] | null>(null);
  const [availableStudyVideoIds, setAvailableStudyVideoIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    let active = true;
    const load = () => Promise.all([readDifficultSentenceLibrary(), readStudyLibrary()])
      .then(([storedItems, studyVideos]) => {
        if (!active) return;
        setItems(storedItems);
        setAvailableStudyVideoIds(new Set(studyVideos.map((video) => video.id)));
      });
    void load();
    const update = () => void load();
    window.addEventListener(LOCAL_LEARNING_DATA_CHANGED_EVENT, update);
    return () => {
      active = false;
      window.removeEventListener(LOCAL_LEARNING_DATA_CHANGED_EVENT, update);
    };
  }, []);
  return { items, availableStudyVideoIds };
}

export function DifficultSentenceLibraryOverview() {
  const { items } = useDifficultSentenceData();
  const pending = items?.filter((item) => !item.analysis).length ?? 0;
  const recent = items?.slice(0, 3) ?? [];
  return (
    <section className="difficult-library-overview" aria-labelledby="difficult-overview-title">
      <div>
        <p className="eyebrow">DIFFICULT SENTENCE LIBRARY</p>
        <h2 id="difficult-overview-title">难句解析库</h2>
        <p>保留真正难懂的句子，回到原视频理解它为什么听不清。</p>
        {recent.length > 0 ? (
          <ul aria-label="最近加入的 Difficult Sentences">
            {recent.map((item) => <li key={item.id}>{item.snapshot.text}</li>)}
          </ul>
        ) : (
          <p>从 Listening Practice 中加入一句后，会先安全保存，再开始解析。</p>
        )}
      </div>
      <Link href="/difficult-sentences">
        {items === null
          ? "打开难句库 ↗"
          : `查看 ${items.length} 句${pending > 0 ? ` · ${pending} 条待解析` : ""} ↗`}
      </Link>
    </section>
  );
}

export function DifficultSentenceLibrary({
  initialFilter = "all",
  initialQuery = "",
}: {
  initialFilter?: DifficultSentenceFilter;
  initialQuery?: string;
}) {
  const { items, availableStudyVideoIds } = useDifficultSentenceData();
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<DifficultSentenceFilter>(initialFilter);
  const filtered = useMemo(
    () => items?.filter((item) => difficultSentenceMatches(item, query, filter)) ?? [],
    [filter, items, query],
  );
  const detailQuery = `?query=${encodeURIComponent(query)}&status=${filter}`;
  return (
    <main className="difficult-library-page" id="main-content">
      <header>
        <div><p className="eyebrow">DIFFICULT SENTENCE LIBRARY</p><h1>难句解析库</h1></div>
        <Link href="/">返回学习库</Link>
      </header>
      <div className="difficult-library-filters">
        <label><span>搜索难句</span><input aria-label="搜索难句" onChange={(event) => setQuery(event.currentTarget.value)} placeholder="句子、重点内容或视频标题" value={query} /></label>
        <label><span>学习状态</span><select aria-label="学习状态筛选" onChange={(event) => setFilter(event.currentTarget.value as DifficultSentenceFilter)} value={filter}>
          <option value="all">全部</option><option value="pending">待解析</option><option value="learning">Learning</option><option value="mastered">Mastered</option>
        </select></label>
      </div>
      {items === null ? <p role="status">正在读取难句库…</p> : null}
      {items && filtered.length === 0 ? <p className="difficult-library-empty">没有符合条件的 Difficult Sentence。</p> : null}
      <div className="difficult-library-grid">
        {filtered.map((item) => {
          const state = item.analysis ? item.learningState === "mastered" ? "Mastered" : "Learning" : "Pending analysis";
          const sourceAvailable = availableStudyVideoIds.has(item.origin.studyVideoId);
          const hasRelatedSnapshot = (items ?? []).some(
            (candidate) =>
              candidate.id !== item.id &&
              candidate.origin.studyVideoId === item.origin.studyVideoId &&
              candidate.snapshot.startSeconds === item.snapshot.startSeconds &&
              candidate.snapshot.endSeconds === item.snapshot.endSeconds,
          );
          return (
            <article key={item.id}>
              <div><span>{state}</span><span>{formatMediaTime(item.snapshot.endSeconds - item.snapshot.startSeconds)}</span></div>
              <h2>{item.snapshot.text}</h2>
              <p>{item.origin.studyVideoTitle}</p>
              <time dateTime={item.collectedAt}>
                {new Intl.DateTimeFormat("zh-CN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(item.collectedAt))}
              </time>
              {hasRelatedSnapshot ? <small>同一原视频时间范围还有其他句子版本</small> : null}
              {!sourceAvailable ? <small>来源 Study Video 已不在学习库</small> : null}
              <Link href={`/difficult-sentences/${encodeURIComponent(item.id)}${detailQuery}`}>打开解析 ↗</Link>
            </article>
          );
        })}
      </div>
    </main>
  );
}
