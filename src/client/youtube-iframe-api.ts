import type { YouTubeVideoId } from "@/domain/study-video";

export type YouTubePlayerInstance = {
  destroy: () => void;
  getAvailablePlaybackRates: () => number[];
  getCurrentTime: () => number;
  getDuration: () => number;
  pauseVideo: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setPlaybackRate: (rate: number) => void;
};

type YouTubePlayerOptions = {
  height: number;
  width: number;
  videoId: YouTubeVideoId;
  playerVars: {
    cc_load_policy: 0 | 1;
    controls: 0 | 1;
    origin: string;
    playsinline: 0 | 1;
  };
  events: {
    onError: (event: { data: number }) => void;
    onPlaybackRateChange: (event: { data: number }) => void;
    onReady: (event: { target: YouTubePlayerInstance }) => void;
  };
};

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement,
        options: YouTubePlayerOptions,
      ) => YouTubePlayerInstance;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}
