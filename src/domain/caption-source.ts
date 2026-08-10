import {
  SentenceSplitterSyntax,
  split,
  type TxtSentenceNode,
} from "sentence-splitter";

import type {
  CaptionCue,
  CaptionFormat,
  CaptionSource,
  CaptionSourceId,
  CaptionSourceKind,
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
const MINIMUM_ROLLING_OVERLAP_CHARACTERS = 4;
const MAXIMUM_ROLLING_SNAPSHOT_SECONDS = 0.05;
const TERMINAL_PUNCTUATION_PATTERN = /[.!?](?:["'”’\])}]*)$/;
const ADDRESS_CONTEXT_PATTERN = String.raw`(?:\b\d{1,6}\s+|\b(?:[Aa]long|[Aa]t|[Dd]own|[Nn]ear|[Oo]n|[Oo]nto|[Pp]ast|[Rr]eached|[Tt]oward|[Tt]owards|[Uu]p)\s+)`;
const STREET_NAME_PATTERN = String.raw`(?:[A-Z][A-Za-z'-]*\s+){1,4}`;
const ADDRESS_SUFFIX_BOUNDARY_PATTERN = new RegExp(
  `${ADDRESS_CONTEXT_PATTERN}${STREET_NAME_PATTERN}(?:Ave|Blvd|Ln|Rd|St)\\.(?=\\s+[A-Z])`,
  "g",
);

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

function decodeCharacterReference(reference: string): string {
  const namedReferences: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
    lrm: "",
    rlm: "",
  };
  const body = reference.slice(1, -1);
  if (body in namedReferences) return namedReferences[body] ?? "";

  const numericValue = body.startsWith("#x") || body.startsWith("#X")
    ? Number.parseInt(body.slice(2), 16)
    : body.startsWith("#")
      ? Number.parseInt(body.slice(1), 10)
      : Number.NaN;

  if (
    !Number.isInteger(numericValue) ||
    numericValue < 0 ||
    numericValue > 0x10ffff
  ) {
    return reference;
  }

  return String.fromCodePoint(numericValue);
}

function cleanCueText(lines: string[]): string {
  return lines
    .join(" ")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/<v(?:\.[^\s>]*)?\s+([^>]+)>/gi, (_, speaker: string) =>
      `${speaker.trim()}: `,
    )
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:#\d+|#x[\da-f]+|[a-z]+);/gi, decodeCharacterReference)
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function rollingOverlapLength(previousText: string, currentText: string): number {
  const maximumLength = Math.min(previousText.length, currentText.length);
  const lowerPreviousText = previousText.toLocaleLowerCase("en-US");
  const lowerCurrentText = currentText.toLocaleLowerCase("en-US");

  for (
    let length = maximumLength;
    length >= MINIMUM_ROLLING_OVERLAP_CHARACTERS;
    length -= 1
  ) {
    const previousStart = previousText.length - length;
    const beginsAtWordBoundary =
      previousStart === 0 || /[\s([{“‘]/.test(previousText[previousStart - 1] ?? "");
    const endsAtWordBoundary =
      length === currentText.length ||
      /[\s,.;:!?\])}”’]/.test(currentText[length] ?? "");

    if (
      beginsAtWordBoundary &&
      endsAtWordBoundary &&
      lowerPreviousText.slice(previousStart) === lowerCurrentText.slice(0, length)
    ) {
      return length;
    }
  }

  return 0;
}

function normalizeRollingCues(cues: CaptionCue[]): CaptionCue[] {
  const normalizedCues: CaptionCue[] = [];
  let previousRawCue: CaptionCue | undefined;

  for (const cue of cues) {
    let overlapLength = 0;
    const previousDuration = previousRawCue
      ? previousRawCue.endSeconds - previousRawCue.startSeconds
      : Number.POSITIVE_INFINITY;
    const cueDuration = cue.endSeconds - cue.startSeconds;
    const overlapsPrevious =
      previousRawCue !== undefined &&
      cue.startSeconds < previousRawCue.endSeconds;
    const touchesRollingSnapshot =
      previousRawCue !== undefined &&
      cue.startSeconds === previousRawCue.endSeconds &&
      Math.min(previousDuration, cueDuration) <=
        MAXIMUM_ROLLING_SNAPSHOT_SECONDS;

    if (previousRawCue && (overlapsPrevious || touchesRollingSnapshot)) {
      overlapLength = rollingOverlapLength(previousRawCue.text, cue.text);
    }
    const normalizedText = cue.text.slice(overlapLength).trimStart();

    previousRawCue = cue;
    if (!normalizedText) continue;
    normalizedCues.push({ ...cue, text: normalizedText });
  }

  return normalizedCues;
}

type CueTextFragment = {
  endRatio: number;
  startRatio: number;
  text: string;
};

function isSentenceNode(value: unknown): value is TxtSentenceNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === SentenceSplitterSyntax.Sentence
  );
}

type TextRange = {
  end: number;
  start: number;
};

function splitAddressSuffixBoundaries(
  text: string,
  sentenceRange: TextRange,
): TextRange[] {
  const ranges: TextRange[] = [];
  const sentenceText = text.slice(sentenceRange.start, sentenceRange.end);
  let rangeStart = sentenceRange.start;

  for (const match of sentenceText.matchAll(ADDRESS_SUFFIX_BOUNDARY_PATTERN)) {
    if (match.index === undefined) continue;
    const boundary = sentenceRange.start + match.index + match[0].length;
    ranges.push({ start: rangeStart, end: boundary });
    rangeStart = boundary;
  }

  ranges.push({ start: rangeStart, end: sentenceRange.end });
  return ranges;
}

function splitCueText(text: string): CueTextFragment[] {
  const textRanges = split(text)
    .filter(isSentenceNode)
    .flatMap((sentence) =>
      splitAddressSuffixBoundaries(text, {
        start: sentence.range[0],
        end: sentence.range[1],
      }),
    );

  return textRanges.map((range, index) => ({
    endRatio: index === textRanges.length - 1 ? 1 : range.end / text.length,
    startRatio:
      index === 0 ? 0 : (textRanges[index - 1]?.end ?? range.start) / text.length,
    text: text.slice(range.start, range.end).trim(),
  }));
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
    endSeconds <= startSeconds
  ) {
    throw new CaptionSourceParseError(
      `第 ${index + 1} 个时间段无效，请检查起止时间和英文内容。`,
    );
  }
  if (!text) return null;

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
  return parseCaptionSource(id, fileName, contents, "learner-supplied");
}

export function parseCaptionSource(
  id: CaptionSourceId,
  fileName: string,
  contents: string,
  kind: CaptionSourceKind,
): CaptionSource {
  const format = formatForFileName(fileName);
  const normalized = contents.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

  const [firstLine = "", ...remainingLines] = normalized.split("\n");
  if (format === "vtt" && !/^WEBVTT(?:[ \t].*)?$/.test(firstLine)) {
    throw new CaptionSourceParseError(
      "VTT 文件缺少 WEBVTT 文件头，请检查文件是否完整。",
    );
  }

  let body = normalized;
  if (format === "vtt") {
    const headerBoundary = normalized.match(/\n[ \t]*\n/);
    body =
      headerBoundary?.index === undefined
        ? remainingLines.join("\n")
        : normalized.slice(headerBoundary.index + headerBoundary[0].length);
  }
  const parsedCues = body
    .split(/\n{2,}/)
    .map((block, index) => cueFromBlock(block, index, format))
    .filter((cue): cue is CaptionCue => cue !== null)
    .sort(
      (left, right) =>
        left.startSeconds - right.startSeconds ||
        left.endSeconds - right.endSeconds ||
        left.id.localeCompare(right.id),
    );
  const cues = normalizeRollingCues(parsedCues);

  if (cues.length === 0) {
    throw new CaptionSourceParseError(
      "没有找到有效的字幕时间段，请检查时间格式和英文内容。",
    );
  }

  return {
    id,
    kind,
    format,
    fileName,
    cues,
  };
}

export function learningSentencesFromCues(
  captionSource: CaptionSource,
): LearningSentence[] {
  const captionFragments = captionSource.cues.flatMap((cue) =>
    splitCueText(cue.text).map((fragment) => {
      const cueDuration = cue.endSeconds - cue.startSeconds;
      return {
        cue,
        endSeconds: cue.startSeconds + cueDuration * fragment.endRatio,
        startSeconds: cue.startSeconds + cueDuration * fragment.startRatio,
        text: fragment.text,
      };
    }),
  );
  const sentences: LearningSentence[] = [];
  let sentenceFragments: typeof captionFragments = [];

  const finishSentence = () => {
    const firstFragment = sentenceFragments[0];
    const lastFragment = sentenceFragments.at(-1);
    if (!firstFragment || !lastFragment) return;

    sentences.push({
      id: learningSentenceIdForIndex(sentences.length),
      captionSourceId: captionSource.id,
      sourceCueIds: [
        ...new Set(sentenceFragments.map(({ cue }) => cue.id)),
      ],
      startSeconds: firstFragment.startSeconds,
      endSeconds: lastFragment.endSeconds,
      text: sentenceFragments
        .map(({ text }) => text)
        .join(" ")
        .replace(/\s+([,.;:!?\])}”’])/g, "$1"),
    });
    sentenceFragments = [];
  };

  captionFragments.forEach((fragment, index) => {
    sentenceFragments.push(fragment);
    const nextFragment = captionFragments[index + 1];
    const gapToNextCue = nextFragment
      ? nextFragment.startSeconds - fragment.endSeconds
      : Number.POSITIVE_INFINITY;

    if (
      TERMINAL_PUNCTUATION_PATTERN.test(fragment.text) ||
      gapToNextCue >= MAXIMUM_SENTENCE_GAP_SECONDS
    ) {
      finishSentence();
    }
  });

  finishSentence();
  return sentences;
}
