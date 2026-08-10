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

export type YouTubePlayerHandle = {
  getDuration: () => number;
  seekTo: (seconds: number) => void;
  seekAndPlay: (seconds: number) => void;
};

type YouTubePlayerProps = {
  className?: string;
  onError?: (code: number) => void;
  onReady?: (player: YouTubePlayerInstance) => void;
  videoId: string;
};

export const YouTubePlayer = forwardRef<
  YouTubePlayerHandle,
  YouTubePlayerProps
>(function YouTubePlayer(
  { className, onError, onReady, videoId },
  forwardedRef,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayerInstance | null>(null);
  const onErrorRef = useRef(onError);
  const onReadyRef = useRef(onReady);

  onErrorRef.current = onError;
  onReadyRef.current = onReady;

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
        onReady: (event) => onReadyRef.current?.(event.target),
      },
    });
  }, [videoId]);

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
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [initializePlayer]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      getDuration: () => playerRef.current?.getDuration() ?? 0,
      seekTo: (seconds) => playerRef.current?.seekTo(seconds, true),
      seekAndPlay: (seconds) => {
        playerRef.current?.seekTo(seconds, true);
        playerRef.current?.playVideo();
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
