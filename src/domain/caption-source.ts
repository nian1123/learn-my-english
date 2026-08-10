import type {
  CaptionCue,
  CaptionFormat,
  CaptionSource,
  CaptionSourceId,
  LearningSentence,
} from "./study-video";
import {
  captionCueIdForIndex,
  learningSentenceIdForIndex,
} from "./study-video";

const TIMING_LINE_PATTERN = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/;
const VTT_TIMESTAMP_PATTERN = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/;
const SRT_TIMESTAMP_PATTERN = /^(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})$/;
const MAXIMUM_SENTENCE_GAP_SECONDS = 3;
const TERMINAL_PUNCTUATION_PATTERN = /[.!?](?:["'”’\])}]*)$/;

export class CaptionSourceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptionSourceParseError";
  }
}

function formatForFileName(fileName: string): CaptionFormat {
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension === "vtt" || extension === "srt") return extension;

  throw new CaptionSourceParseError(
    "Caption Source 只支持 .vtt 或 .srt 格式，请重新选择文件。",
  );
}

function timestampSeconds(value: string, format: CaptionFormat): number | null {
  const match = value.match(
    format === "vtt" ? VTT_TIMESTAMP_PATTERN : SRT_TIMESTAMP_PATTERN,
  );
  if (!match) return null;

  const [, hoursValue, minutesValue, secondsValue, millisecondsValue] = match;
  const hours = format === "vtt" && hoursValue === undefined ? 0 : Number(hoursValue);
  const minutes = Number(minutesValue);
  const seconds = Number(secondsValue);
  const milliseconds = Number(millisecondsValue);
  const total = hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
  return Number.isFinite(total) ? total : null;
}

function cleanCueText(lines: string[]): string {
  return lines
    .join(" ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cueFromBlock(
  block: string,
  index: number,
  format: CaptionFormat,
): CaptionCue | null {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;
  if (/^(NOTE|STYLE|REGION)(\s|$)/.test(lines[0] ?? "")) return null;

  const timingIndex = lines.findIndex((line) => line.includes("-->"));
  if (timingIndex < 0) {
    throw new CaptionSourceParseError(
      `第 ${index + 1} 个区块缺少有效时间轴，请检查箭头和时间格式。`,
    );
  }

  const timing = lines[timingIndex]?.match(TIMING_LINE_PATTERN);
  if (!timing) {
    throw new CaptionSourceParseError(
      `第 ${index + 1} 个时间段无效，请检查起止时间和英文内容。`,
    );
  }

  const startSeconds = timestampSeconds(timing[1], format);
  const endSeconds = timestampSeconds(timing[2], format);
  const text = cleanCueText(lines.slice(timingIndex + 1));

  if (
    startSeconds === null ||
    endSeconds === null ||
    startSeconds < 0 ||
    endSeconds <= startSeconds ||
    !text
  ) {
    throw new CaptionSourceParseError(
      `第 ${index + 1} 个时间段无效，请检查起止时间和英文内容。`,
    );
  }

  return {
    id: captionCueIdForIndex(index),
    startSeconds,
    endSeconds,
    text,
  };
}

export function parseLearnerCaptionSource(
  id: CaptionSourceId,
  fileName: string,
  contents: string,
): CaptionSource {
  const format = formatForFileName(fileName);
  const normalized = contents.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

  const [firstLine = "", ...remainingLines] = normalized.split("\n");
  if (format === "vtt" && !/^WEBVTT(?:[ \t].*)?$/.test(firstLine)) {
    throw new CaptionSourceParseError(
      "VTT 文件缺少 WEBVTT 文件头，请检查文件是否完整。",
    );
  }

  const body = format === "vtt" ? remainingLines.join("\n") : normalized;
  const cues = body
    .split(/\n{2,}/)
    .map((block, index) => cueFromBlock(block, index, format))
    .filter((cue): cue is CaptionCue => cue !== null)
    .sort((left, right) => left.startSeconds - right.startSeconds);

  if (cues.length === 0) {
    throw new CaptionSourceParseError(
      "没有找到有效的字幕时间段，请检查时间格式和英文内容。",
    );
  }

  return {
    id,
    kind: "learner-supplied",
    format,
    fileName,
    cues,
  };
}

export function learningSentencesFromCues(
  captionSource: CaptionSource,
): LearningSentence[] {
  const sentences: LearningSentence[] = [];
  let sentenceCues: CaptionCue[] = [];

  const finishSentence = () => {
    const firstCue = sentenceCues[0];
    const lastCue = sentenceCues.at(-1);
    if (!firstCue || !lastCue) return;

    sentences.push({
      id: learningSentenceIdForIndex(sentences.length),
      captionSourceId: captionSource.id,
      sourceCueIds: sentenceCues.map((cue) => cue.id),
      startSeconds: firstCue.startSeconds,
      endSeconds: lastCue.endSeconds,
      text: sentenceCues.map((cue) => cue.text).join(" "),
    });
    sentenceCues = [];
  };

  captionSource.cues.forEach((cue, index) => {
    sentenceCues.push(cue);
    const nextCue = captionSource.cues[index + 1];
    const gapToNextCue = nextCue
      ? nextCue.startSeconds - cue.endSeconds
      : Number.POSITIVE_INFINITY;

    if (
      TERMINAL_PUNCTUATION_PATTERN.test(cue.text) ||
      gapToNextCue >= MAXIMUM_SENTENCE_GAP_SECONDS
    ) {
      finishSentence();
    }
  });

  finishSentence();
  return sentences;
}
