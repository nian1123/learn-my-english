"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  DEFAULT_LEARNER_PREFERENCES,
  readLearnerPreferences,
} from "@/client/learner-preferences";
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
  const [repeatSentenceId, setRepeatSentenceId] =
    useState<LearningSentenceId | null>(null);
  const [inRepeatGap, setInRepeatGap] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [supportedPlaybackRates, setSupportedPlaybackRates] = useState<
    number[]
  >([]);
  const [transcriptHidden, setTranscriptHidden] = useState(false);
  const playerRef = useRef<YouTubePlayerHandle>(null);
  const activeSentenceRef = useRef<HTMLButtonElement>(null);
  const selectedSentenceIdRef = useRef<LearningSentenceId | null>(null);
  const positionWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const keyboardActionsRef = useRef<{
    nextSentence: () => void;
    previousSentence: () => void;
    toggleRepeat: () => void;
    toggleTranscript: () => void;
  }>({
    nextSentence: () => undefined,
    previousSentence: () => undefined,
    toggleRepeat: () => undefined,
    toggleTranscript: () => undefined,
  });

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

  const syncActiveSentence = useCallback(
    (positionSeconds: number) => {
      if (repeatSentenceId) {
        setActiveSentenceId((current) =>
          current === repeatSentenceId ? current : repeatSentenceId,
        );
        return;
      }

      const nextActiveSentenceId =
        studyVideo?.learningSentences.find(
          (sentence) =>
            positionSeconds >= sentence.startSeconds &&
            positionSeconds < sentence.endSeconds,
        )?.id ?? null;

      if (nextActiveSentenceId) {
        selectedSentenceIdRef.current = nextActiveSentenceId;
      }
      setActiveSentenceId((current) =>
        current === nextActiveSentenceId ? current : nextActiveSentenceId,
      );
    },
    [repeatSentenceId, studyVideo?.learningSentences],
  );

  useEffect(() => {
    let active = true;

    Promise.all([
      readStudyVideo(studyVideoId),
      readLearnerPreferences().catch(() => DEFAULT_LEARNER_PREFERENCES),
    ])
      .then(([storedStudyVideo, preferences]) => {
        if (!active) return;
        setStudyVideo(storedStudyVideo);
        setTranscriptHidden(preferences.hideTranscriptByDefault);
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

  useEffect(() => {
    if (!activeSentenceId) return;
    activeSentenceRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeSentenceId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))
      ) {
        return;
      }

      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        keyboardActionsRef.current.previousSentence();
        return;
      }
      if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        keyboardActionsRef.current.nextSentence();
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        keyboardActionsRef.current.toggleRepeat();
      } else if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        keyboardActionsRef.current.toggleTranscript();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (loading) {
    return <main className="study-loading" id="main-content">正在打开 Study Video…</main>;
  }

  if (loadFailed || !studyVideo) {
    return (
      <main className="study-loading" id="main-content">
        <h1>找不到这个 Study Video</h1>
        <p>本地数据可能已被清除，或链接已经失效。</p>
        <Link href="/">返回学习库</Link>
      </main>
    );
  }

  const playSentence = (sentence: LearningSentence) => {
    selectedSentenceIdRef.current = sentence.id;
    setActiveSentenceId(sentence.id);
    if (repeatSentenceId) {
      setRepeatSentenceId(sentence.id);
      playerRef.current?.setRepeatInterval({
        endSeconds: sentence.endSeconds,
        startSeconds: sentence.startSeconds,
      });
    }
    playerRef.current?.playFrom(sentence.startSeconds);
  };

  const selectedSentenceId =
    activeSentenceId ?? repeatSentenceId ?? selectedSentenceIdRef.current;
  const activeSentenceIndex = studyVideo.learningSentences.findIndex(
    (sentence) => sentence.id === selectedSentenceId,
  );
  const selectedSentenceIndex =
    activeSentenceIndex >= 0 ? activeSentenceIndex : 0;
  const playAdjacentSentence = (offset: -1 | 1) => {
    const nextSentence =
      studyVideo.learningSentences[selectedSentenceIndex + offset];
    if (nextSentence) playSentence(nextSentence);
  };
  const toggleRepeat = () => {
    if (repeatSentenceId) {
      setRepeatSentenceId(null);
      playerRef.current?.setRepeatInterval(null);
      return;
    }

    const sentence = studyVideo.learningSentences[selectedSentenceIndex];
    if (!sentence) return;
    selectedSentenceIdRef.current = sentence.id;
    setActiveSentenceId(sentence.id);
    setRepeatSentenceId(sentence.id);
    playerRef.current?.setRepeatInterval({
      endSeconds: sentence.endSeconds,
      startSeconds: sentence.startSeconds,
    });
  };
  const toggleTranscript = () => setTranscriptHidden((current) => !current);

  keyboardActionsRef.current = {
    nextSentence: () => playAdjacentSentence(1),
    previousSentence: () => playAdjacentSentence(-1),
    toggleRepeat,
    toggleTranscript,
  };

  const captionSourceLabel = {
    "auto-generated": "Auto-generated captions",
    "learner-supplied": `学习者提供的 Caption Source · ${studyVideo.captionSource.format.toUpperCase()}`,
    manual: "Manual captions",
  }[studyVideo.captionSource.kind];

  return (
    <main className="study-page" id="main-content">
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
            initialPositionSeconds={studyVideo.lastPositionSeconds}
            onError={(code) =>
              setPlayerError(`YouTube 播放器无法载入（错误 ${code}）。`)
            }
            onPlaybackRateChange={setPlaybackRate}
            onPlaybackRatesChange={setSupportedPlaybackRates}
            onPositionChange={persistPosition}
            onRepeatGapChange={setInRepeatGap}
            onTimeChange={syncActiveSentence}
            ref={playerRef}
            videoId={studyVideo.youtubeVideoId}
          />
          {playerError ? (
            <p className="study-player-error" role="alert">
              {playerError}
            </p>
          ) : null}
          <div className="caption-source-badge">
            <strong>{captionSourceLabel}</strong>
            <span>
              YouTube 原生字幕默认关闭；需要时使用播放器内 CC，逐句高亮不依赖它。
            </span>
          </div>
          <div className="listening-controls" aria-label="逐句播放控制">
            <button
              disabled={selectedSentenceIndex === 0}
              onClick={() => playAdjacentSentence(-1)}
              type="button"
            >
              上一句 <span>Alt + ←</span>
            </button>
            <button
              disabled={
                selectedSentenceIndex ===
                studyVideo.learningSentences.length - 1
              }
              onClick={() => playAdjacentSentence(1)}
              type="button"
            >
              下一句 <span>Alt + →</span>
            </button>
            <button
              aria-pressed={repeatSentenceId !== null}
              className={repeatSentenceId ? "active" : undefined}
              onClick={toggleRepeat}
              type="button"
            >
              单句循环 <span>R</span>
            </button>
            <button
              aria-pressed={transcriptHidden}
              className={transcriptHidden ? "active" : undefined}
              onClick={toggleTranscript}
              type="button"
            >
              {transcriptHidden ? "显示原文" : "隐藏原文"} <span>T</span>
            </button>
          </div>
          <div className="playback-rate-controls" aria-label="播放速度">
            <span>播放速度</span>
            {[0.75, 1].map((rate) =>
              supportedPlaybackRates.includes(rate) ? (
                <button
                  aria-pressed={playbackRate === rate}
                  className={playbackRate === rate ? "active" : undefined}
                  key={rate}
                  onClick={() => playerRef.current?.setPlaybackRate(rate)}
                  type="button"
                >
                  {rate}x
                </button>
              ) : null,
            )}
          </div>
          <p className="shortcut-guide">
            快捷键：Alt + ←/→ 切换句子 · R 单句循环 · T 显示/隐藏原文
          </p>
          {inRepeatGap ? (
            <p className="repeat-gap-status" role="status">
              3 秒跟读空档
            </p>
          ) : null}
        </section>

        <section className="sentence-column" aria-labelledby="sentence-title">
          <div className="sentence-heading">
            <div>
              <p className="eyebrow">LEARNING SENTENCES</p>
              <h2 id="sentence-title">逐句练习</h2>
            </div>
            <span>{studyVideo.learningSentences.length} 句</span>
          </div>
          <ol
            className={
              transcriptHidden
                ? "sentence-list transcript-hidden"
                : "sentence-list"
            }
          >
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
                  ref={
                    activeSentenceId === sentence.id
                      ? activeSentenceRef
                      : undefined
                  }
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
