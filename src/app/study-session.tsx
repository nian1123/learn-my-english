"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  readStudyVideo,
  updateStudyPosition,
} from "@/client/study-video-library";
import type {
  LearningSentence,
  LearningSentenceId,
  StudyVideo,
  StudyVideoId,
} from "@/domain/study-video";
import { formatMediaTime } from "@/domain/time";

import { YouTubePlayer, type YouTubePlayerHandle } from "./youtube-player";

export function StudySession({ studyVideoId }: { studyVideoId: StudyVideoId }) {
  const [studyVideo, setStudyVideo] = useState<StudyVideo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [activeSentenceId, setActiveSentenceId] =
    useState<LearningSentenceId | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const playerRef = useRef<YouTubePlayerHandle>(null);
  const positionWriteQueueRef = useRef<Promise<void>>(Promise.resolve());

  const persistPosition = useCallback(
    (positionSeconds: number) => {
      positionWriteQueueRef.current = positionWriteQueueRef.current
        .catch(() => undefined)
        .then(() => updateStudyPosition(studyVideoId, positionSeconds))
        .then(() => {
          setStudyVideo((current) =>
            current
              ? { ...current, lastPositionSeconds: positionSeconds }
              : current,
          );
        })
        .catch(() => undefined);
    },
    [studyVideoId],
  );

  useEffect(() => {
    let active = true;

    readStudyVideo(studyVideoId)
      .then((storedStudyVideo) => {
        if (!active) return;
        setStudyVideo(storedStudyVideo);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoadFailed(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [studyVideoId]);

  if (loading) {
    return <main className="study-loading">正在打开 Study Video…</main>;
  }

  if (loadFailed || !studyVideo) {
    return (
      <main className="study-loading">
        <h1>找不到这个 Study Video</h1>
        <p>本地数据可能已被清除，或链接已经失效。</p>
        <Link href="/">返回学习库</Link>
      </main>
    );
  }

  const playSentence = (sentence: LearningSentence) => {
    setActiveSentenceId(sentence.id);
    playerRef.current?.playInterval(
      sentence.startSeconds,
      sentence.endSeconds,
    );
  };

  return (
    <main className="study-page">
      <header className="study-header">
        <Link href="/">← 返回学习库</Link>
        <div>
          <p className="eyebrow">STUDY VIDEO</p>
          <h1>{studyVideo.title}</h1>
          <p>
            {studyVideo.channel} · {formatMediaTime(studyVideo.durationSeconds)} ·
            上次位置 {formatMediaTime(studyVideo.lastPositionSeconds)}
          </p>
        </div>
      </header>

      <div className="study-workspace">
        <section className="player-column" aria-label="YouTube 播放器">
          <YouTubePlayer
            className="study-player"
            onError={(code) =>
              setPlayerError(`YouTube 播放器无法载入（错误 ${code}）。`)
            }
            onPositionChange={persistPosition}
            onReady={(player) => {
              if (studyVideo.lastPositionSeconds > 0) {
                player.seekTo(studyVideo.lastPositionSeconds, true);
              }
            }}
            ref={playerRef}
            videoId={studyVideo.youtubeVideoId}
          />
          {playerError ? (
            <p className="study-player-error" role="alert">
              {playerError}
            </p>
          ) : null}
          <div className="caption-source-badge">
            学习者提供的 Caption Source · {studyVideo.captionSource.format.toUpperCase()}
          </div>
        </section>

        <section className="sentence-column" aria-labelledby="sentence-title">
          <div className="sentence-heading">
            <div>
              <p className="eyebrow">LEARNING SENTENCES</p>
              <h2 id="sentence-title">逐句练习</h2>
            </div>
            <span>{studyVideo.learningSentences.length} 句</span>
          </div>
          <ol className="sentence-list">
            {studyVideo.learningSentences.map((sentence, index) => (
              <li key={sentence.id}>
                <button
                  aria-label={`播放第 ${index + 1} 句`}
                  className={
                    activeSentenceId === sentence.id
                      ? "learning-sentence active"
                      : "learning-sentence"
                  }
                  onClick={() => playSentence(sentence)}
                  type="button"
                >
                  <span>{formatMediaTime(sentence.startSeconds)}</span>
                  <strong>{sentence.text}</strong>
                </button>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
