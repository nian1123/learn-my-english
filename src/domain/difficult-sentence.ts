import type {
  CaptionSourceId,
  LearningSentenceId,
  LocalRevisionSentence,
  StudyVideo,
  StudyVideoId,
  YouTubeVideoId,
} from "./study-video";

declare const difficultSentenceIdBrand: unique symbol;

export type DifficultSentenceId = string & {
  readonly [difficultSentenceIdBrand]: true;
};

export type DifficultSentenceSnapshot = {
  learningSentenceId: LearningSentenceId;
  captionSourceId: CaptionSourceId;
  sourceCueIds: string[];
  originalSentenceIds: LearningSentenceId[];
  text: string;
  startSeconds: number;
  endSeconds: number;
  previousSentenceText?: string;
  nextSentenceText?: string;
};

export type DifficultSentenceOrigin = {
  studyVideoId: StudyVideoId;
  youtubeVideoId: YouTubeVideoId;
  studyVideoTitle: string;
  studyVideoChannel: string;
  studyVideoThumbnailUrl: string;
};

export type DifficultSentenceTextRange = {
  start: number;
  end: number;
  text: string;
};

export type ImportantContentItem = DifficultSentenceTextRange & {
  contextualMeaning: string;
  informationContribution: string;
  listeningPriority: string;
};

export type WeakFormPrediction = DifficultSentenceTextRange & {
  reducedForm: string;
  listeningCue: string;
};

export type DifficultSentenceAnalysis = {
  naturalMeaning: string;
  listeningSkeleton: string;
  captureOrder: string[];
  importantItems: ImportantContentItem[];
  weakForms: WeakFormPrediction[];
};

export type DifficultSentenceProvenance = "ai" | "manual" | "edited";
export type DifficultSentenceLearningState = "learning" | "mastered";

export type DifficultSentence = {
  schemaVersion: 1;
  id: DifficultSentenceId;
  collectedAt: string;
  updatedAt: string;
  generationStatus: "pending" | "complete";
  snapshot: DifficultSentenceSnapshot;
  origin: DifficultSentenceOrigin;
  analysis?: DifficultSentenceAnalysis;
  provenance?: DifficultSentenceProvenance;
  learningState?: DifficultSentenceLearningState;
};

const DIFFICULT_SENTENCE_ID_PATTERN =
  /^difficult-sentence-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function difficultSentenceIdFromUuid(uuid: string): DifficultSentenceId {
  const id = `difficult-sentence-${uuid}`;
  if (!DIFFICULT_SENTENCE_ID_PATTERN.test(id)) {
    throw new Error("Invalid Difficult Sentence identifier");
  }
  return id as DifficultSentenceId;
}

export function isDifficultSentenceId(
  value: string,
): value is DifficultSentenceId {
  return DIFFICULT_SENTENCE_ID_PATTERN.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
) {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function parseTextRange(
  value: unknown,
  sourceText: string,
  additionalKeys: readonly string[],
): DifficultSentenceTextRange | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["start", "end", "text", ...additionalKeys]) ||
    !Number.isInteger(value.start) ||
    !Number.isInteger(value.end) ||
    (value.start as number) < 0 ||
    (value.end as number) <= (value.start as number) ||
    (value.end as number) > sourceText.length ||
    !isNonEmptyString(value.text) ||
    sourceText.slice(value.start as number, value.end as number) !== value.text
  ) {
    return null;
  }
  return {
    start: value.start as number,
    end: value.end as number,
    text: value.text,
  };
}

export function parseDifficultSentenceAnalysis(
  value: unknown,
  sourceText: string,
): DifficultSentenceAnalysis | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "naturalMeaning",
      "listeningSkeleton",
      "captureOrder",
      "importantItems",
      "weakForms",
    ]) ||
    !isNonEmptyString(value.naturalMeaning) ||
    !isNonEmptyString(value.listeningSkeleton) ||
    !Array.isArray(value.captureOrder) ||
    value.captureOrder.length === 0 ||
    !value.captureOrder.every(isNonEmptyString) ||
    !Array.isArray(value.importantItems) ||
    !Array.isArray(value.weakForms)
  ) {
    return null;
  }

  const importantItems: ImportantContentItem[] = [];
  for (const candidate of value.importantItems) {
    const range = parseTextRange(candidate, sourceText, [
      "contextualMeaning",
      "informationContribution",
      "listeningPriority",
    ]);
    if (
      !range ||
      !isRecord(candidate) ||
      !isNonEmptyString(candidate.contextualMeaning) ||
      !isNonEmptyString(candidate.informationContribution) ||
      !isNonEmptyString(candidate.listeningPriority)
    ) {
      return null;
    }
    importantItems.push({
      ...range,
      contextualMeaning: candidate.contextualMeaning.trim(),
      informationContribution: candidate.informationContribution.trim(),
      listeningPriority: candidate.listeningPriority.trim(),
    });
  }

  const weakForms: WeakFormPrediction[] = [];
  for (const candidate of value.weakForms) {
    const range = parseTextRange(candidate, sourceText, [
      "reducedForm",
      "listeningCue",
    ]);
    if (
      !range ||
      !isRecord(candidate) ||
      !isNonEmptyString(candidate.reducedForm) ||
      !isNonEmptyString(candidate.listeningCue)
    ) {
      return null;
    }
    weakForms.push({
      ...range,
      reducedForm: candidate.reducedForm.trim(),
      listeningCue: candidate.listeningCue.trim(),
    });
  }

  for (const items of [importantItems, weakForms]) {
    const uniqueRanges = new Set<string>();
    for (const item of items) {
      const key = `${item.start}:${item.end}:${item.text}`;
      if (uniqueRanges.has(key)) return null;
      uniqueRanges.add(key);
    }
  }

  return {
    naturalMeaning: value.naturalMeaning.trim(),
    listeningSkeleton: value.listeningSkeleton.trim(),
    captureOrder: value.captureOrder.map((item) => item.trim()),
    importantItems,
    weakForms,
  };
}

export function isDifficultSentence(value: unknown): value is DifficultSentence {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "id",
      "collectedAt",
      "updatedAt",
      "generationStatus",
      "snapshot",
      "origin",
      ...(value.generationStatus === "complete"
        ? ["analysis", "provenance", "learningState"]
        : []),
    ])
  ) {
    return false;
  }
  const candidate = value as Partial<DifficultSentence>;
  const snapshot = candidate.snapshot as Partial<DifficultSentenceSnapshot> | undefined;
  const origin = candidate.origin as Partial<DifficultSentenceOrigin> | undefined;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.id === "string" &&
    isDifficultSentenceId(candidate.id) &&
    isIsoDate(candidate.collectedAt) &&
    isIsoDate(candidate.updatedAt) &&
    (candidate.generationStatus === "pending" ||
      candidate.generationStatus === "complete") &&
    Boolean(snapshot) &&
    isRecord(snapshot) &&
    hasExactKeys(snapshot, [
      "learningSentenceId",
      "captionSourceId",
      "sourceCueIds",
      "originalSentenceIds",
      "text",
      "startSeconds",
      "endSeconds",
      ...(snapshot.previousSentenceText === undefined
        ? []
        : ["previousSentenceText"]),
      ...(snapshot.nextSentenceText === undefined
        ? []
        : ["nextSentenceText"]),
    ]) &&
    isNonEmptyString(snapshot?.learningSentenceId) &&
    isNonEmptyString(snapshot?.captionSourceId) &&
    Array.isArray(snapshot?.sourceCueIds) &&
    snapshot.sourceCueIds.length > 0 &&
    snapshot.sourceCueIds.every(isNonEmptyString) &&
    Array.isArray(snapshot?.originalSentenceIds) &&
    snapshot.originalSentenceIds.length > 0 &&
    snapshot.originalSentenceIds.every(isNonEmptyString) &&
    isNonEmptyString(snapshot?.text) &&
    typeof snapshot?.startSeconds === "number" &&
    Number.isFinite(snapshot.startSeconds) &&
    snapshot.startSeconds >= 0 &&
    typeof snapshot?.endSeconds === "number" &&
    Number.isFinite(snapshot.endSeconds) &&
    snapshot.endSeconds > snapshot.startSeconds &&
    (snapshot.previousSentenceText === undefined ||
      isNonEmptyString(snapshot.previousSentenceText)) &&
    (snapshot.nextSentenceText === undefined ||
      isNonEmptyString(snapshot.nextSentenceText)) &&
    Boolean(origin) &&
    isRecord(origin) &&
    hasExactKeys(origin, [
      "studyVideoId",
      "youtubeVideoId",
      "studyVideoTitle",
      "studyVideoChannel",
      "studyVideoThumbnailUrl",
    ]) &&
    isNonEmptyString(origin?.studyVideoId) &&
    isNonEmptyString(origin?.youtubeVideoId) &&
    isNonEmptyString(origin?.studyVideoTitle) &&
    isNonEmptyString(origin?.studyVideoChannel) &&
    typeof origin?.studyVideoThumbnailUrl === "string" &&
    (candidate.generationStatus === "pending"
      ? candidate.analysis === undefined &&
        candidate.provenance === undefined &&
        candidate.learningState === undefined
      : Boolean(
          parseDifficultSentenceAnalysis(candidate.analysis, snapshot?.text ?? ""),
        ) &&
        (candidate.provenance === "ai" ||
          candidate.provenance === "manual" ||
          candidate.provenance === "edited") &&
        (candidate.learningState === "learning" ||
          candidate.learningState === "mastered"))
  );
}

export function difficultSentenceHasSameSnapshot(
  difficultSentence: DifficultSentence,
  studyVideoId: StudyVideoId,
  sentence: LocalRevisionSentence,
) {
  const snapshot = difficultSentence.snapshot;
  return (
    difficultSentence.origin.studyVideoId === studyVideoId &&
    snapshot.learningSentenceId === sentence.id &&
    snapshot.captionSourceId === sentence.captionSourceId &&
    snapshot.text === sentence.text &&
    snapshot.startSeconds === sentence.startSeconds &&
    snapshot.endSeconds === sentence.endSeconds &&
    snapshot.sourceCueIds.length === sentence.sourceCueIds.length &&
    snapshot.sourceCueIds.every(
      (id, index) => id === sentence.sourceCueIds[index],
    ) &&
    snapshot.originalSentenceIds.length === sentence.originalSentenceIds.length &&
    snapshot.originalSentenceIds.every(
      (id, index) => id === sentence.originalSentenceIds[index],
    )
  );
}

export function createPendingDifficultSentence({
  adjacentSentences,
  collectedAt = new Date().toISOString(),
  id,
  sentence,
  studyVideo,
}: {
  adjacentSentences: {
    previous?: LocalRevisionSentence;
    next?: LocalRevisionSentence;
  };
  collectedAt?: string;
  id: DifficultSentenceId;
  sentence: LocalRevisionSentence;
  studyVideo: StudyVideo;
}): DifficultSentence {
  return {
    schemaVersion: 1,
    id,
    collectedAt,
    updatedAt: collectedAt,
    generationStatus: "pending",
    snapshot: {
      learningSentenceId: sentence.id,
      captionSourceId: sentence.captionSourceId,
      sourceCueIds: [...sentence.sourceCueIds],
      originalSentenceIds: [...sentence.originalSentenceIds],
      text: sentence.text,
      startSeconds: sentence.startSeconds,
      endSeconds: sentence.endSeconds,
      ...(adjacentSentences.previous
        ? { previousSentenceText: adjacentSentences.previous.text }
        : {}),
      ...(adjacentSentences.next
        ? { nextSentenceText: adjacentSentences.next.text }
        : {}),
    },
    origin: {
      studyVideoId: studyVideo.id,
      youtubeVideoId: studyVideo.youtubeVideoId,
      studyVideoTitle: studyVideo.title,
      studyVideoChannel: studyVideo.channel,
      studyVideoThumbnailUrl: studyVideo.thumbnailUrl,
    },
  };
}
