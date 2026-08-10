export type CaptionFormat = "srt" | "vtt";

export type CaptionCue = {
  id: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
};

export type CaptionSource = {
  id: string;
  kind: "learner-supplied";
  format: CaptionFormat;
  fileName: string;
  cues: CaptionCue[];
};

export type LearningSentence = {
  id: string;
  captionSourceId: string;
  sourceCueIds: string[];
  startSeconds: number;
  endSeconds: number;
  text: string;
};

export type StudyVideo = {
  schemaVersion: 1;
  id: string;
  youtubeVideoId: string;
  title: string;
  channel: string;
  thumbnailUrl: string;
  durationSeconds: number;
  lastPositionSeconds: number;
  lastStudiedAt: string;
  captionSource: CaptionSource;
  learningSentences: LearningSentence[];
};

export type YouTubeVideoMetadata = {
  videoId: string;
  canonicalUrl: string;
  title: string;
  channel: string;
  thumbnailUrl: string;
};
