import {
  parseDifficultSentenceAnalysis,
  type DifficultSentenceAnalysis,
} from "./difficult-sentence";

export type DifficultSentenceAnalysisRequest = {
  task: "difficult-sentence-analysis";
  sentence: string;
  previousSentence?: string;
  nextSentence?: string;
  interval: { startSeconds: number; endSeconds: number };
};

export type DifficultSentenceAnalysisApiRequest = {
  analysis: DifficultSentenceAnalysisRequest;
  allowDeepSeekFallback: boolean;
};

export type DifficultSentenceAnalysisResponse =
  | {
      status: "available";
      mode: "local-ai" | "deepseek";
      result: DifficultSentenceAnalysis;
    }
  | {
      status: "unavailable";
      reason:
        | "not-configured"
        | "timeout"
        | "invalid-output"
        | "provider-failure"
        | "deepseek-consent-required"
        | "deepseek-timeout"
        | "deepseek-invalid-output"
        | "deepseek-provider-failure";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
) {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function nonEmptyString(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    Boolean(value.trim()) &&
    value.length <= maximumLength
  );
}

export function parseDifficultSentenceAnalysisApiRequest(
  value: unknown,
): DifficultSentenceAnalysisApiRequest | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["analysis", "allowDeepSeekFallback"]) ||
    typeof value.allowDeepSeekFallback !== "boolean" ||
    !isRecord(value.analysis) ||
    !hasOnlyKeys(value.analysis, [
      "task",
      "sentence",
      "previousSentence",
      "nextSentence",
      "interval",
    ]) ||
    value.analysis.task !== "difficult-sentence-analysis" ||
    !nonEmptyString(value.analysis.sentence, 10_000) ||
    (value.analysis.previousSentence !== undefined &&
      !nonEmptyString(value.analysis.previousSentence, 10_000)) ||
    (value.analysis.nextSentence !== undefined &&
      !nonEmptyString(value.analysis.nextSentence, 10_000)) ||
    !isRecord(value.analysis.interval) ||
    !hasOnlyKeys(value.analysis.interval, ["startSeconds", "endSeconds"]) ||
    typeof value.analysis.interval.startSeconds !== "number" ||
    !Number.isFinite(value.analysis.interval.startSeconds) ||
    value.analysis.interval.startSeconds < 0 ||
    typeof value.analysis.interval.endSeconds !== "number" ||
    !Number.isFinite(value.analysis.interval.endSeconds) ||
    value.analysis.interval.endSeconds <= value.analysis.interval.startSeconds
  ) {
    return null;
  }
  return value as DifficultSentenceAnalysisApiRequest;
}

export function parseDifficultSentenceAnalysisResponse(
  value: unknown,
  sentence: string,
): DifficultSentenceAnalysisResponse | null {
  if (!isRecord(value)) return null;
  if (value.status === "available") {
    if (
      (value.mode !== "local-ai" && value.mode !== "deepseek") ||
      !hasOnlyKeys(value, ["status", "mode", "result"])
    ) {
      return null;
    }
    const result = parseDifficultSentenceAnalysis(value.result, sentence);
    return result ? { status: "available", mode: value.mode, result } : null;
  }
  const reasons = new Set([
    "not-configured",
    "timeout",
    "invalid-output",
    "provider-failure",
    "deepseek-consent-required",
    "deepseek-timeout",
    "deepseek-invalid-output",
    "deepseek-provider-failure",
  ]);
  return value.status === "unavailable" &&
    hasOnlyKeys(value, ["status", "reason"]) &&
    typeof value.reason === "string" &&
    reasons.has(value.reason)
    ? (value as DifficultSentenceAnalysisResponse)
    : null;
}
