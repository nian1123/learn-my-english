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
  pause: () => void;
  playFrom: (seconds: number) => void;
  setPlaybackRate: (rate: number) => void;
  setRepeatInterval: (interval: PlaybackInterval | null) => void;
};

export type PlaybackInterval = {
  endSeconds: number;
  startSeconds: number;
};

export type PlayerReadiness = {
  getDuration: () => number;
};

type YouTubePlayerProps = {
  className?: string;
  initialPositionSeconds?: number;
  onError?: (code: number) => void;
  onPlaybackRateChange?: (rate: number) => void;
  onPlaybackRatesChange?: (rates: number[]) => void;
  onPositionChange?: (seconds: number) => void;
  onReady?: (player: PlayerReadiness) => void;
  onRepeatGapChange?: (inGap: boolean) => void;
  onTimeChange?: (seconds: number) => void;
  videoId: YouTubeVideoId;
};

export const YouTubePlayer = forwardRef<
  YouTubePlayerHandle,
  YouTubePlayerProps
>(function YouTubePlayer(
  {
    className,
    initialPositionSeconds = 0,
    onError,
    onPlaybackRateChange,
    onPlaybackRatesChange,
    onPositionChange,
    onReady,
    onRepeatGapChange,
    onTimeChange,
    videoId,
  },
  forwardedRef,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayerInstance | null>(null);
  const initialPlaybackRef = useRef({
    positionSeconds: initialPositionSeconds,
    videoId,
  });
  const pendingPlaybackRef = useRef<number | null>(null);
  const positionTimerRef = useRef<number | null>(null);
  const repeatGapTimerRef = useRef<number | null>(null);
  const repeatIntervalRef = useRef<PlaybackInterval | null>(null);
  const inRepeatGapRef = useRef(false);
  const lastReportedSecondRef = useRef<number | null>(null);
  const onErrorRef = useRef(onError);
  const onPlaybackRateChangeRef = useRef(onPlaybackRateChange);
  const onPlaybackRatesChangeRef = useRef(onPlaybackRatesChange);
  const onPositionChangeRef = useRef(onPositionChange);
  const onReadyRef = useRef(onReady);
  const onRepeatGapChangeRef = useRef(onRepeatGapChange);
  const onTimeChangeRef = useRef(onTimeChange);

  onErrorRef.current = onError;
  onPlaybackRateChangeRef.current = onPlaybackRateChange;
  onPlaybackRatesChangeRef.current = onPlaybackRatesChange;
  onPositionChangeRef.current = onPositionChange;
  onReadyRef.current = onReady;
  onRepeatGapChangeRef.current = onRepeatGapChange;
  onTimeChangeRef.current = onTimeChange;
  if (initialPlaybackRef.current.videoId !== videoId) {
    initialPlaybackRef.current = {
      positionSeconds: initialPositionSeconds,
      videoId,
    };
  }

  const leaveRepeatGap = useCallback(() => {
    if (!inRepeatGapRef.current) return;
    inRepeatGapRef.current = false;
    onRepeatGapChangeRef.current?.(false);
  }, []);

  const clearRepeatGapTimer = useCallback(() => {
    if (repeatGapTimerRef.current === null) return;
    window.clearTimeout(repeatGapTimerRef.current);
    repeatGapTimerRef.current = null;
  }, []);

  const startPositionMonitoring = useCallback(
    (player: YouTubePlayerInstance) => {
      if (positionTimerRef.current !== null) return;

      positionTimerRef.current = window.setInterval(() => {
        const position = player.getCurrentTime();
        if (!Number.isFinite(position) || position < 0) return;

        const repeatInterval = repeatIntervalRef.current;
        if (
          repeatInterval &&
          !inRepeatGapRef.current &&
          position >= repeatInterval.endSeconds
        ) {
          player.pauseVideo();
          inRepeatGapRef.current = true;
          onRepeatGapChangeRef.current?.(true);
          repeatGapTimerRef.current = window.setTimeout(() => {
            repeatGapTimerRef.current = null;
            const currentInterval = repeatIntervalRef.current;
            if (!currentInterval) return;
            player.seekTo(currentInterval.startSeconds, true);
            player.playVideo();
            leaveRepeatGap();
          }, 3_000);
        }

        onTimeChangeRef.current?.(position);

        const wholeSecond = Math.floor(position);
        if (wholeSecond !== lastReportedSecondRef.current) {
          lastReportedSecondRef.current = wholeSecond;
          onPositionChangeRef.current?.(wholeSecond);
        }
      }, 250);
    },
    [leaveRepeatGap],
  );

  const initializePlayer = useCallback(() => {
    if (!window.YT || !containerRef.current || playerRef.current) return;

    playerRef.current = new window.YT.Player(containerRef.current, {
      height: 360,
      width: 640,
      videoId,
      playerVars: {
        cc_load_policy: 0,
        controls: 1,
        origin: window.location.origin,
        playsinline: 1,
      },
      events: {
        onError: (event) => onErrorRef.current?.(event.data),
        onPlaybackRateChange: (event) =>
          onPlaybackRateChangeRef.current?.(event.data),
        onReady: (event) => {
          startPositionMonitoring(event.target);
          onPlaybackRatesChangeRef.current?.(
            event.target
              .getAvailablePlaybackRates()
              .filter((rate) => Number.isFinite(rate) && rate > 0),
          );
          const pendingPlayback = pendingPlaybackRef.current;
          if (pendingPlayback !== null) {
            event.target.seekTo(pendingPlayback, true);
            event.target.playVideo();
            pendingPlaybackRef.current = null;
          } else if (initialPlaybackRef.current.positionSeconds > 0) {
            event.target.seekTo(
              initialPlaybackRef.current.positionSeconds,
              true,
            );
          }
          onReadyRef.current?.({
            getDuration: () => event.target.getDuration(),
          });
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
      clearRepeatGapTimer();
      leaveRepeatGap();
      repeatIntervalRef.current = null;
      pendingPlaybackRef.current = null;
      lastReportedSecondRef.current = null;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [clearRepeatGapTimer, initializePlayer, leaveRepeatGap]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      pause: () => {
        playerRef.current?.pauseVideo();
      },
      playFrom: (seconds) => {
        clearRepeatGapTimer();
        leaveRepeatGap();
        const player = playerRef.current;
        if (!player) {
          pendingPlaybackRef.current = seconds;
          return;
        }

        player.seekTo(seconds, true);
        player.playVideo();
      },
      setPlaybackRate: (rate) => {
        playerRef.current?.setPlaybackRate(rate);
      },
      setRepeatInterval: (interval) => {
        const wasInRepeatGap = inRepeatGapRef.current;
        clearRepeatGapTimer();
        leaveRepeatGap();
        repeatIntervalRef.current = interval;

        if (!interval && wasInRepeatGap) {
          playerRef.current?.playVideo();
        }
      },
    }),
    [clearRepeatGapTimer, leaveRepeatGap],
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
