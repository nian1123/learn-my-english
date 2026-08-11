"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { announceLocalLearningDataChanged } from "@/client/local-learning-data-events";
import { deleteStudyVideoLearningData } from "@/client/study-video-deletion";
import { readStudyLibrary } from "@/client/study-video-library";
import type { StudyVideo } from "@/domain/study-video";
import { formatMediaTime } from "@/domain/time";

import { StudyVideoDeletionDialog } from "./study-video-deletion-dialog";

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

function LoadingLibrary() {
  return (
    <div aria-label="正在读取学习库" className="study-video-grid" role="status">
      <span className="sr-only">正在读取学习库</span>
      {[0, 1, 2].map((index) => (
        <div aria-hidden="true" className="study-video-skeleton" key={index}>
          <span />
          <i />
          <i />
          <i />
        </div>
      ))}
    </div>
  );
}

function progressPercent(studyVideo: StudyVideo) {
  if (studyVideo.durationSeconds <= 0) return 0;
  return Math.min(
    100,
    Math.max(
      0,
      Math.round(
        (studyVideo.lastPositionSeconds / studyVideo.durationSeconds) * 100,
      ),
    ),
  );
}

export function StudyLibraryList() {
  const [studyVideos, setStudyVideos] = useState<StudyVideo[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [deletionTarget, setDeletionTarget] = useState<StudyVideo | null>(null);
  const [removeWordBankContexts, setRemoveWordBankContexts] = useState(false);
  const [deletionStatus, setDeletionStatus] = useState<
    "idle" | "deleting" | "error"
  >("idle");

  useEffect(() => {
    let active = true;

    readStudyLibrary()
      .then((storedStudyVideos) => {
        if (active) setStudyVideos(storedStudyVideos);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });

    return () => {
      active = false;
    };
  }, []);

  const cancelDeletion = useCallback(() => {
    if (deletionStatus === "deleting") return;
    setDeletionTarget(null);
    setRemoveWordBankContexts(false);
    setDeletionStatus("idle");
  }, [deletionStatus]);

  const openDeletion = (studyVideo: StudyVideo) => {
    setDeletionTarget(studyVideo);
    setRemoveWordBankContexts(false);
    setDeletionStatus("idle");
  };

  const confirmDeletion = async () => {
    if (!deletionTarget || deletionStatus === "deleting") return;
    setDeletionStatus("deleting");
    try {
      await deleteStudyVideoLearningData(
        deletionTarget.id,
        removeWordBankContexts
          ? "remove-word-bank-contexts"
          : "retain-word-bank-contexts",
      );
      setStudyVideos((current) =>
        current?.filter((studyVideo) => studyVideo.id !== deletionTarget.id) ?? [],
      );
      announceLocalLearningDataChanged();
      setDeletionTarget(null);
      setRemoveWordBankContexts(false);
      setDeletionStatus("idle");
    } catch {
      setDeletionStatus("error");
    }
  };

  const count = studyVideos?.length ?? 0;
  const sentenceCount =
    studyVideos?.reduce(
      (total, studyVideo) => total + studyVideo.learningSentences.length,
      0,
    ) ?? 0;
  const startedCount =
    studyVideos?.filter((studyVideo) => studyVideo.lastPositionSeconds > 0)
      .length ?? 0;

  return (
    <section className="library-section" aria-labelledby="library-title">
      <div className="library-overview" aria-label="学习库概览">
        <div>
          <span>VIDEOS</span>
          <strong>{studyVideos ? count : "—"}</strong>
        </div>
        <div>
          <span>SENTENCES</span>
          <strong>{studyVideos ? sentenceCount : "—"}</strong>
        </div>
        <div>
          <span>IN PROGRESS</span>
          <strong>{studyVideos ? startedCount : "—"}</strong>
        </div>
      </div>

      <div className="section-heading">
        <div>
          <p className="eyebrow">YOUR ARCHIVE</p>
          <h2 id="library-title">最近学习</h2>
        </div>
        <span className="count-label">{count} 个视频 · 最近学习优先</span>
      </div>

      {loadFailed ? (
        <div className="library-load-error" role="alert">
          无法读取本地学习库，请检查 Chrome 的网站数据权限。
        </div>
      ) : null}

      {studyVideos?.length === 0 ? (
        <div className="empty-state">
          <EmptyLibraryIllustration />
          <div>
            <p className="empty-kicker">START WITH ONE INTERVIEW</p>
            <h3>还没有学习视频</h3>
            <p>
              选择一段你真的想听懂的公开 YouTube
              访谈。应用会先尝试获取已有英文字幕；如果失败，再上传 VTT 或 SRT
              文件继续。
            </p>
            <ul>
              <li>普通点播视频，时长不超过 3 小时</li>
              <li>视频允许嵌入播放</li>
              <li>无可用字幕时可上传英文 VTT/SRT</li>
            </ul>
          </div>
        </div>
      ) : null}

      {studyVideos === null && !loadFailed ? <LoadingLibrary /> : null}

      {studyVideos && studyVideos.length > 0 ? (
        <div className="study-video-grid">
          {studyVideos.map((studyVideo) => (
            <article className="study-video-card" key={studyVideo.id}>
              <div className="study-video-cover">
                <img
                  alt={`${studyVideo.title} 缩略图`}
                  src={studyVideo.thumbnailUrl}
                />
                <span className="language-badge">EN</span>
                <span className="duration-badge">
                  {formatMediaTime(studyVideo.durationSeconds)}
                </span>
              </div>
              <div className="study-video-card-copy">
                <p>{studyVideo.channel}</p>
                <h3>{studyVideo.title}</h3>
                <div className="study-video-meta">
                  <span>{studyVideo.learningSentences.length} 个 Learning Sentences</span>
                  <span>上次位置 {formatMediaTime(studyVideo.lastPositionSeconds)}</span>
                </div>
                <div className="progress-heading">
                  <span>学习进度</span>
                  <strong>{progressPercent(studyVideo)}%</strong>
                </div>
                <progress
                  aria-label="学习进度"
                  max="100"
                  value={progressPercent(studyVideo)}
                />
                <div className="study-video-actions">
                  <Link href={`/study/${encodeURIComponent(studyVideo.id)}`}>
                    <span>继续学习</span>
                    <span aria-hidden="true">↗</span>
                  </Link>
                  <button
                    aria-label={`删除 Study Video：${studyVideo.title}`}
                    onClick={() => openDeletion(studyVideo)}
                    type="button"
                  >
                    删除
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {deletionTarget ? (
        <StudyVideoDeletionDialog
          deleting={deletionStatus === "deleting"}
          error={deletionStatus === "error"}
          onCancel={cancelDeletion}
          onConfirm={() => void confirmDeletion()}
          onRemoveWordBankContextsChange={setRemoveWordBankContexts}
          removeWordBankContexts={removeWordBankContexts}
          studyVideo={deletionTarget}
        />
      ) : null}
    </section>
  );
}
