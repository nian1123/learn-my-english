export type CaptionFormat = "srt" | "vtt";
export type CaptionSourceKind =
  | "auto-generated"
  | "learner-supplied"
  | "manual"
  | "platform-provided";

declare const captionCueIdBrand: unique symbol;
declare const captionSourceIdBrand: unique symbol;
declare const learningSentenceIdBrand: unique symbol;
declare const studyVideoIdBrand: unique symbol;
declare const youtubeVideoIdBrand: unique symbol;

export type CaptionCueId = string & { readonly [captionCueIdBrand]: true };
export type CaptionSourceId = string & {
  readonly [captionSourceIdBrand]: true;
};
export type LearningSentenceId = string & {
  readonly [learningSentenceIdBrand]: true;
};
export type StudyVideoId = string & { readonly [studyVideoIdBrand]: true };
export type YouTubeVideoId = string & { readonly [youtubeVideoIdBrand]: true };

export function captionCueIdForIndex(index: number): CaptionCueId {
  return `cue-${index + 1}` as CaptionCueId;
}

export function captionSourceIdFor(
  videoId: YouTubeVideoId,
): CaptionSourceId {
  return `caption-${videoId}` as CaptionSourceId;
}

export function learningSentenceIdForIndex(
  index: number,
): LearningSentenceId {
  return `sentence-${index + 1}` as LearningSentenceId;
}

export function studyVideoIdFor(videoId: YouTubeVideoId): StudyVideoId {
  return `study-video-${videoId}` as StudyVideoId;
}

export function isStudyVideoId(value: string): value is StudyVideoId {
  return /^study-video-[A-Za-z0-9_-]{11}$/.test(value);
}

export type CaptionCue = {
  id: CaptionCueId;
  startSeconds: number;
  endSeconds: number;
  text: string;
};

export type CaptionSource = {
  id: CaptionSourceId;
  kind: CaptionSourceKind;
  format: CaptionFormat;
  fileName: string;
  cues: CaptionCue[];
};

export type LearningSentence = {
  id: LearningSentenceId;
  captionSourceId: CaptionSourceId;
  sourceCueIds: CaptionCueId[];
  startSeconds: number;
  endSeconds: number;
  text: string;
};

export type LocalRevisionSentence = LearningSentence & {
  originalSentenceIds: LearningSentenceId[];
};

export type LocalRevision = {
  sentences: LocalRevisionSentence[];
};

export type StudyVideo = {
  schemaVersion: 1;
  id: StudyVideoId;
  youtubeVideoId: YouTubeVideoId;
  title: string;
  channel: string;
  thumbnailUrl: string;
  durationSeconds: number;
  lastPositionSeconds: number;
  lastStudiedAt: string;
  captionSource: CaptionSource;
  learningSentences: LearningSentence[];
  localRevision?: LocalRevision;
};

export type YouTubeVideoMetadata = {
  videoId: YouTubeVideoId;
  canonicalUrl: string;
  title: string;
  channel: string;
  thumbnailUrl: string;
};
