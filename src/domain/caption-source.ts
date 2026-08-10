import type {
  CaptionCue,
  CaptionFormat,
  CaptionSource,
  LearningSentence,
} from "./study-video";

const TIMING_PATTERN =
  /^(\d{2,}:\d{2}:\d{2}[.,]\d{3}|\d{2}:\d{2}[.,]\d{3})\s+-->\s+(\d{2,}:\d{2}:\d{2}[.,]\d{3}|\d{2}:\d{2}[.,]\d{3})(?:\s+.*)?$/;

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

function timestampSeconds(value: string): number {
  const normalized = value.replace(",", ".");
  const parts = normalized.split(":");
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length > 0 ? Number(parts.pop()) : 0;
  return hours * 3600 + minutes * 60 + seconds;
}

function cleanCueText(lines: string[]): string {
  return lines
    .join(" ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cueFromBlock(block: string, index: number): CaptionCue | null {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;
  if (/^(NOTE|STYLE|REGION)(\s|$)/.test(lines[0] ?? "")) return null;

  const timingIndex = lines.findIndex((line) => TIMING_PATTERN.test(line));
  if (timingIndex < 0) {
    throw new CaptionSourceParseError(
      `第 ${index + 1} 个区块缺少有效时间轴，请检查箭头和时间格式。`,
    );
  }

  const timing = lines[timingIndex]?.match(TIMING_PATTERN);
  if (!timing) return null;

  const startSeconds = timestampSeconds(timing[1]);
  const endSeconds = timestampSeconds(timing[2]);
  const text = cleanCueText(lines.slice(timingIndex + 1));

  if (
    !Number.isFinite(startSeconds) ||
    !Number.isFinite(endSeconds) ||
    startSeconds < 0 ||
    endSeconds <= startSeconds ||
    !text
  ) {
    throw new CaptionSourceParseError(
      `第 ${index + 1} 个时间段无效，请检查起止时间和英文内容。`,
    );
  }

  return {
    id: `cue-${index + 1}`,
    startSeconds,
    endSeconds,
    text,
  };
}

export function parseLearnerCaptionSource(
  id: string,
  fileName: string,
  contents: string,
): CaptionSource {
  const format = formatForFileName(fileName);
  const normalized = contents.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

  if (format === "vtt" && !normalized.trimStart().startsWith("WEBVTT")) {
    throw new CaptionSourceParseError(
      "VTT 文件缺少 WEBVTT 文件头，请检查文件是否完整。",
    );
  }

  const body = format === "vtt" ? normalized.replace(/^\s*WEBVTT[^\n]*\n?/, "") : normalized;
  const cues = body
    .split(/\n{2,}/)
    .map(cueFromBlock)
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
  return captionSource.cues.map((cue, index) => ({
    id: `sentence-${index + 1}`,
    captionSourceId: captionSource.id,
    sourceCueIds: [cue.id],
    startSeconds: cue.startSeconds,
    endSeconds: cue.endSeconds,
    text: cue.text,
  }));
}
