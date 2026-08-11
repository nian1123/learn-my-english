import type {
  CaptionCueId,
  LearningSentence,
  LearningSentenceId,
  LocalRevisionSentence,
  StudyVideo,
} from "./study-video";

export type EffectiveLearningSentence = LocalRevisionSentence & {
  revised: boolean;
};

export type LocalRevisionCommand =
  | {
      type: "edit";
      sentenceId: LearningSentenceId;
      text: string;
      startSeconds: number;
      endSeconds: number;
    }
  | {
      type: "split";
      sentenceId: LearningSentenceId;
      splitPosition: number;
    }
  | {
      type: "merge";
      sentenceId: LearningSentenceId;
      direction: "previous" | "next";
    }
  | { type: "restore-sentence"; sentenceId: LearningSentenceId }
  | { type: "restore-all" };

export type LocalRevisionResult = {
  studyVideo: StudyVideo;
  selectedSentenceId: LearningSentenceId;
};

export class LocalRevisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalRevisionError";
  }
}

function revisionSentenceFromOriginal(
  sentence: LearningSentence,
): LocalRevisionSentence {
  return {
    ...sentence,
    originalSentenceIds: [sentence.id],
    sourceCueIds: [...sentence.sourceCueIds],
  };
}

function sameIds(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function matchesOriginal(
  sentence: LocalRevisionSentence,
  originals: readonly LearningSentence[],
) {
  if (sentence.originalSentenceIds.length !== 1) return false;
  const original = originals.find(
    (candidate) => candidate.id === sentence.originalSentenceIds[0],
  );
  return (
    original !== undefined &&
    sentence.id === original.id &&
    sentence.captionSourceId === original.captionSourceId &&
    sameIds(sentence.sourceCueIds, original.sourceCueIds) &&
    sentence.startSeconds === original.startSeconds &&
    sentence.endSeconds === original.endSeconds &&
    sentence.text === original.text
  );
}

function withoutLocalRevision(studyVideo: StudyVideo): StudyVideo {
  const { localRevision: _localRevision, ...originalStudyVideo } = studyVideo;
  return originalStudyVideo;
}

function withRevision(
  studyVideo: StudyVideo,
  sentences: LocalRevisionSentence[],
): StudyVideo {
  const isOriginal =
    sentences.length === studyVideo.learningSentences.length &&
    sentences.every((sentence, index) => {
      const original = studyVideo.learningSentences[index];
      return (
        original?.id === sentence.id && matchesOriginal(sentence, [original])
      );
    });

  if (isOriginal) return withoutLocalRevision(studyVideo);
  return { ...studyVideo, localRevision: { sentences } };
}

function workingSentences(studyVideo: StudyVideo): LocalRevisionSentence[] {
  if (!studyVideo.localRevision) {
    return studyVideo.learningSentences.map(revisionSentenceFromOriginal);
  }
  return studyVideo.localRevision.sentences.map((sentence) => ({
    ...sentence,
    originalSentenceIds: [...sentence.originalSentenceIds],
    sourceCueIds: [...sentence.sourceCueIds],
  }));
}

export function effectiveLearningSentences(
  studyVideo: StudyVideo,
): EffectiveLearningSentence[] {
  return workingSentences(studyVideo).map((sentence) => ({
    ...sentence,
    revised: !matchesOriginal(sentence, studyVideo.learningSentences),
  }));
}

export function hasLocalRevisions(studyVideo: StudyVideo): boolean {
  return effectiveLearningSentences(studyVideo).some(
    (sentence) => sentence.revised,
  );
}

export function sentenceSplitPositions(text: string): number[] {
  const positions: number[] = [];
  for (const match of text.matchAll(/\s+/g)) {
    const position = match.index;
    if (position > 0 && position < text.length) positions.push(position);
  }
  return positions;
}

function sentenceIndex(
  sentences: readonly LocalRevisionSentence[],
  sentenceId: LearningSentenceId,
) {
  const index = sentences.findIndex((sentence) => sentence.id === sentenceId);
  if (index < 0) throw new LocalRevisionError("找不到要修订的句子");
  return index;
}

function firstOriginalSentenceId(studyVideo: StudyVideo) {
  const firstSentence = studyVideo.learningSentences[0];
  if (!firstSentence) {
    throw new LocalRevisionError("Study Video 没有可恢复的原始句子");
  }
  return firstSentence.id;
}

function validateEdit(
  studyVideo: StudyVideo,
  sentences: readonly LocalRevisionSentence[],
  index: number,
  text: string,
  startSeconds: number,
  endSeconds: number,
) {
  if (!text.trim()) throw new LocalRevisionError("句子文本不能为空");
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
    throw new LocalRevisionError("请输入有效的开始和结束时间");
  }
  if (startSeconds < 0) {
    throw new LocalRevisionError("开始时间不能早于 0 秒");
  }
  if (endSeconds <= startSeconds) {
    throw new LocalRevisionError("结束时间必须晚于开始时间");
  }
  if (endSeconds > studyVideo.durationSeconds) {
    throw new LocalRevisionError("结束时间不能晚于视频时长");
  }
  const previous = sentences[index - 1];
  if (previous && startSeconds < previous.endSeconds) {
    throw new LocalRevisionError("开始时间不能早于上一句的结束时间");
  }
  const next = sentences[index + 1];
  if (next && endSeconds > next.startSeconds) {
    throw new LocalRevisionError("结束时间不能晚于下一句的开始时间");
  }
}

function revisionIdFactory(sentences: readonly LocalRevisionSentence[]) {
  const ids = new Set(sentences.map((sentence) => sentence.id as string));
  return (seed: LearningSentenceId) => {
    let suffix = 1;
    let candidate = `${seed}-local-${suffix}`;
    while (ids.has(candidate)) {
      suffix += 1;
      candidate = `${seed}-local-${suffix}`;
    }
    ids.add(candidate);
    return candidate as LearningSentenceId;
  };
}

function unionIds<T extends string>(left: readonly T[], right: readonly T[]) {
  return [...new Set([...left, ...right])] as T[];
}

function joinSentenceText(left: string, right: string) {
  return `${left.trim()} ${right.trim()}`.trim();
}

export function applyLocalRevision(
  studyVideo: StudyVideo,
  command: LocalRevisionCommand,
): LocalRevisionResult {
  if (command.type === "restore-all") {
    return {
      studyVideo: withoutLocalRevision(studyVideo),
      selectedSentenceId: firstOriginalSentenceId(studyVideo),
    };
  }

  const sentences = workingSentences(studyVideo);
  const index = sentenceIndex(sentences, command.sentenceId);
  const sentence = sentences[index];

  if (command.type === "edit") {
    validateEdit(
      studyVideo,
      sentences,
      index,
      command.text,
      command.startSeconds,
      command.endSeconds,
    );
    const revisedSentence = {
      ...sentence,
      text: command.text.trim(),
      startSeconds: command.startSeconds,
      endSeconds: command.endSeconds,
    };
    sentences.splice(index, 1, revisedSentence);
    return {
      studyVideo: withRevision(studyVideo, sentences),
      selectedSentenceId: revisedSentence.id,
    };
  }

  if (command.type === "split") {
    if (!sentenceSplitPositions(sentence.text).includes(command.splitPosition)) {
      throw new LocalRevisionError("请选择单词之间的位置拆分句子");
    }
    const leftText = sentence.text.slice(0, command.splitPosition).trim();
    const rightText = sentence.text.slice(command.splitPosition).trim();
    const duration = sentence.endSeconds - sentence.startSeconds;
    const ratio = command.splitPosition / sentence.text.length;
    const splitSeconds = Number(
      (sentence.startSeconds + duration * ratio).toFixed(3),
    );
    if (
      !leftText ||
      !rightText ||
      splitSeconds <= sentence.startSeconds ||
      splitSeconds >= sentence.endSeconds
    ) {
      throw new LocalRevisionError("这个位置无法生成两个有效句子");
    }

    const nextRevisionId = revisionIdFactory(sentences);
    const left: LocalRevisionSentence = {
      ...sentence,
      id: nextRevisionId(sentence.id),
      text: leftText,
      endSeconds: splitSeconds,
      originalSentenceIds: [...sentence.originalSentenceIds],
      sourceCueIds: [...sentence.sourceCueIds],
    };
    const right: LocalRevisionSentence = {
      ...sentence,
      id: nextRevisionId(sentence.id),
      text: rightText,
      startSeconds: splitSeconds,
      originalSentenceIds: [...sentence.originalSentenceIds],
      sourceCueIds: [...sentence.sourceCueIds],
    };
    sentences.splice(index, 1, left, right);
    return {
      studyVideo: withRevision(studyVideo, sentences),
      selectedSentenceId: left.id,
    };
  }

  if (command.type === "merge") {
    const adjacentIndex = command.direction === "previous" ? index - 1 : index + 1;
    const adjacent = sentences[adjacentIndex];
    if (!adjacent) throw new LocalRevisionError("这一侧没有可合并的句子");
    const first = command.direction === "previous" ? adjacent : sentence;
    const second = command.direction === "previous" ? sentence : adjacent;
    const nextRevisionId = revisionIdFactory(sentences);
    const merged: LocalRevisionSentence = {
      ...first,
      id: nextRevisionId(first.id),
      text: joinSentenceText(first.text, second.text),
      startSeconds: first.startSeconds,
      endSeconds: second.endSeconds,
      sourceCueIds: unionIds<CaptionCueId>(
        first.sourceCueIds,
        second.sourceCueIds,
      ),
      originalSentenceIds: unionIds<LearningSentenceId>(
        first.originalSentenceIds,
        second.originalSentenceIds,
      ),
    };
    sentences.splice(Math.min(index, adjacentIndex), 2, merged);
    return {
      studyVideo: withRevision(studyVideo, sentences),
      selectedSentenceId: merged.id,
    };
  }

  const restoredIds = new Set(sentence.originalSentenceIds);
  const insertionIndex = sentences.findIndex((candidate) =>
    candidate.originalSentenceIds.some((id) => restoredIds.has(id)),
  );
  const retained = sentences.filter(
    (candidate) =>
      !candidate.originalSentenceIds.some((id) => restoredIds.has(id)),
  );
  const originals = studyVideo.learningSentences
    .filter((candidate) => restoredIds.has(candidate.id))
    .map(revisionSentenceFromOriginal);
  retained.splice(insertionIndex, 0, ...originals);
  return {
    studyVideo: withRevision(studyVideo, retained),
    selectedSentenceId: originals[0]?.id ?? firstOriginalSentenceId(studyVideo),
  };
}
