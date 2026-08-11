"use client";

import Script from "next/script";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import type { YouTubePlayerInstance } from "@/client/youtube-iframe-api";
import type { YouTubeVideoId } from "@/domain/study-video";

export type YouTubePlayerHandle = {
  playInterval: (startSeconds: number, endSeconds: number) => void;
};

type YouTubePlayerProps = {
  className?: string;
  onError?: (code: number) => void;
  onPositionChange?: (seconds: number) => void;
  onReady?: (player: YouTubePlayerInstance) => void;
  onTimeChange?: (seconds: number) => void;
  videoId: YouTubeVideoId;
};

export const YouTubePlayer = forwardRef<
  YouTubePlayerHandle,
  YouTubePlayerProps
>(function YouTubePlayer(
  { className, onError, onPositionChange, onReady, onTimeChange, videoId },
  forwardedRef,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayerInstance | null>(null);
  const pendingPlaybackRef = useRef<{
    startSeconds: number;
    endSeconds: number;
  } | null>(null);
  const playbackEndRef = useRef<number | null>(null);
  const positionTimerRef = useRef<number | null>(null);
  const lastReportedSecondRef = useRef<number | null>(null);
  const onErrorRef = useRef(onError);
  const onPositionChangeRef = useRef(onPositionChange);
  const onReadyRef = useRef(onReady);
  const onTimeChangeRef = useRef(onTimeChange);

  onErrorRef.current = onError;
  onPositionChangeRef.current = onPositionChange;
  onReadyRef.current = onReady;
  onTimeChangeRef.current = onTimeChange;

  const startPositionMonitoring = useCallback(
    (player: YouTubePlayerInstance) => {
      if (positionTimerRef.current !== null) return;

      positionTimerRef.current = window.setInterval(() => {
        const position = player.getCurrentTime();
        if (!Number.isFinite(position) || position < 0) return;

        const playbackEnd = playbackEndRef.current;
        if (playbackEnd !== null && position >= playbackEnd) {
          player.pauseVideo();
          playbackEndRef.current = null;
        }

        onTimeChangeRef.current?.(position);

        const wholeSecond = Math.floor(position);
        if (wholeSecond !== lastReportedSecondRef.current) {
          lastReportedSecondRef.current = wholeSecond;
          onPositionChangeRef.current?.(wholeSecond);
        }
      }, 250);
    },
    [],
  );

  const initializePlayer = useCallback(() => {
    if (!window.YT || !containerRef.current || playerRef.current) return;

    playerRef.current = new window.YT.Player(containerRef.current, {
      height: 360,
      width: 640,
      videoId,
      playerVars: {
        cc_load_policy: 0,
        origin: window.location.origin,
        playsinline: 1,
      },
      events: {
        onError: (event) => onErrorRef.current?.(event.data),
        onReady: (event) => {
          startPositionMonitoring(event.target);
          const pendingPlayback = pendingPlaybackRef.current;
          if (pendingPlayback) {
            playbackEndRef.current = pendingPlayback.endSeconds;
            event.target.seekTo(pendingPlayback.startSeconds, true);
            event.target.playVideo();
            pendingPlaybackRef.current = null;
          }
          onReadyRef.current?.(event.target);
        },
      },
    });
  }, [startPositionMonitoring, videoId]);

  useEffect(() => {
    const previousReadyCallback = window.onYouTubeIframeAPIReady;
    const readyCallback = () => {
      previousReadyCallback?.();
      initializePlayer();
    };

    window.onYouTubeIframeAPIReady = readyCallback;
    initializePlayer();

    return () => {
      if (window.onYouTubeIframeAPIReady === readyCallback) {
        window.onYouTubeIframeAPIReady = previousReadyCallback;
      }
      if (positionTimerRef.current !== null) {
        window.clearInterval(positionTimerRef.current);
        positionTimerRef.current = null;
      }
      playbackEndRef.current = null;
      pendingPlaybackRef.current = null;
      lastReportedSecondRef.current = null;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [initializePlayer]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      playInterval: (startSeconds, endSeconds) => {
        playbackEndRef.current = endSeconds;
        const player = playerRef.current;
        if (!player) {
          pendingPlaybackRef.current = { startSeconds, endSeconds };
          return;
        }

        player.seekTo(startSeconds, true);
        player.playVideo();
      },
    }),
    [],
  );

  return (
    <div className={className}>
      <Script
        id="youtube-iframe-player-api"
        onLoad={initializePlayer}
        onReady={initializePlayer}
        src="https://www.youtube.com/iframe_api"
        strategy="afterInteractive"
      />
      <div className="youtube-player-frame" ref={containerRef} />
    </div>
  );
});
