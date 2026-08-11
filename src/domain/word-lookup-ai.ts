import type {
  DictionaryLookupResult,
  WordLookupCandidate,
} from "./word-lookup";

export const LOCAL_AI_WORD_LOOKUP_VERSION = "local-ai-v1";

export type WordLookupSense = {
  id: string;
  partOfSpeech: string;
  definition: string;
};

export type WordLookupAiTask = "enrich" | "translate";

export type WordLookupAiRequest = {
  task: WordLookupAiTask;
  expression: string;
  sentence: string;
  senses: WordLookupSense[];
  selectedSenseId?: string;
};

export type WordLookupAiEnrichment = {
  senseId: string;
  auxiliaryExample: string;
};

export type WordLookupAiTranslation = {
  chineseMeaning: string;
};

export type WordLookupAiUnavailableReason =
  | "not-configured"
  | "timeout"
  | "invalid-output"
  | "provider-failure"
  | "deepseek-consent-required"
  | "deepseek-timeout"
  | "deepseek-invalid-output"
  | "deepseek-provider-failure";

export type WordLookupAiMode = "local-ai" | "deepseek";

export type WordLookupAiApiRequest = {
  lookup: WordLookupAiRequest;
  allowDeepSeekFallback: boolean;
};

export type WordLookupAiResponse =
  | {
      status: "available";
      mode: WordLookupAiMode;
      task: "enrich";
      result: WordLookupAiEnrichment;
    }
  | {
      status: "available";
      mode: WordLookupAiMode;
      task: "translate";
      result: WordLookupAiTranslation;
    }
  | {
      status: "unavailable";
      mode: "dictionary-only";
      reason: WordLookupAiUnavailableReason;
    };

const SENSE_ID_PATTERN = /^\d+:\d+:\d+$/;

function nonEmptyString(
  value: unknown,
  maximumLength: number,
): value is string {
  return (
    typeof value === "string" &&
    Boolean(value.trim()) &&
    value.trim().length <= maximumLength
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
) {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

export function dictionarySenseOptions(
  result: Extract<DictionaryLookupResult, { status: "found" }>,
): WordLookupSense[] {
  return result.entries.flatMap((entry, entryIndex) =>
    entry.meanings.flatMap((meaning, meaningIndex) =>
      meaning.definitions.map((definition, definitionIndex) => ({
        id: `${entryIndex}:${meaningIndex}:${definitionIndex}`,
        partOfSpeech: meaning.partOfSpeech,
        definition: definition.definition,
      })),
    ),
  );
}

export function createWordLookupAiRequest(
  task: WordLookupAiTask,
  candidate: WordLookupCandidate,
  sentence: string,
  dictionaryResult: Extract<DictionaryLookupResult, { status: "found" }>,
  selectedSenseId?: string,
): WordLookupAiRequest {
  const availableSenses = dictionarySenseOptions(dictionaryResult).slice(0, 12);
  const senses =
    task === "translate" && selectedSenseId
      ? availableSenses.filter((sense) => sense.id === selectedSenseId)
      : availableSenses;
  return {
    task,
    expression: candidate.normalizedForm,
    sentence,
    senses,
    ...(selectedSenseId ? { selectedSenseId } : {}),
  };
}

export function parseWordLookupAiRequest(
  value: unknown,
): WordLookupAiRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(candidate, [
      "task",
      "expression",
      "sentence",
      "senses",
      "selectedSenseId",
    ]) ||
    (candidate.task !== "enrich" && candidate.task !== "translate") ||
    !nonEmptyString(candidate.expression, 80) ||
    !nonEmptyString(candidate.sentence, 1_000) ||
    !Array.isArray(candidate.senses) ||
    candidate.senses.length < 1 ||
    candidate.senses.length > 12
  ) {
    return null;
  }

  const senses = candidate.senses.flatMap((sense) => {
    if (typeof sense !== "object" || sense === null) return [];
    const item = sense as Record<string, unknown>;
    if (
      !hasOnlyKeys(item, ["id", "partOfSpeech", "definition"]) ||
      !nonEmptyString(item.id, 20) ||
      !SENSE_ID_PATTERN.test(item.id) ||
      !nonEmptyString(item.partOfSpeech, 80) ||
      !nonEmptyString(item.definition, 500)
    ) {
      return [];
    }
    return [
      {
        id: item.id.trim(),
        partOfSpeech: item.partOfSpeech.trim(),
        definition: item.definition.trim(),
      },
    ];
  });
  if (senses.length !== candidate.senses.length) return null;
  if (new Set(senses.map((sense) => sense.id)).size !== senses.length) {
    return null;
  }

  const selectedSenseId = candidate.selectedSenseId;
  if (
    candidate.task === "translate" &&
    (!nonEmptyString(selectedSenseId, 20) ||
      !senses.some((sense) => sense.id === selectedSenseId))
  ) {
    return null;
  }
  if (
    candidate.task === "enrich" &&
    selectedSenseId !== undefined
  ) {
    return null;
  }

  return {
    task: candidate.task,
    expression: candidate.expression.trim(),
    sentence: candidate.sentence.trim(),
    senses,
    ...(typeof selectedSenseId === "string"
      ? { selectedSenseId: selectedSenseId.trim() }
      : {}),
  };
}

export function parseWordLookupAiApiRequest(
  value: unknown,
): WordLookupAiApiRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(candidate, ["lookup", "allowDeepSeekFallback"]) ||
    typeof candidate.allowDeepSeekFallback !== "boolean"
  ) {
    return null;
  }
  const lookup = parseWordLookupAiRequest(candidate.lookup);
  return lookup
    ? { lookup, allowDeepSeekFallback: candidate.allowDeepSeekFallback }
    : null;
}

export function parseWordLookupAiEnrichment(
  value: unknown,
  senses: readonly WordLookupSense[],
): WordLookupAiEnrichment | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(candidate, ["senseId", "auxiliaryExample"]) ||
    !nonEmptyString(candidate.senseId, 20) ||
    !senses.some((sense) => sense.id === candidate.senseId) ||
    !nonEmptyString(candidate.auxiliaryExample, 500)
  ) {
    return null;
  }
  return {
    senseId: candidate.senseId.trim(),
    auxiliaryExample: candidate.auxiliaryExample.trim(),
  };
}

export function parseWordLookupAiTranslation(
  value: unknown,
): WordLookupAiTranslation | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(candidate, ["chineseMeaning"]) ||
    !nonEmptyString(candidate.chineseMeaning, 300)
  ) {
    return null;
  }
  return { chineseMeaning: candidate.chineseMeaning.trim() };
}

export function isWordLookupAiResponse(
  value: unknown,
): value is WordLookupAiResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.status === "unavailable") {
    return (
      hasOnlyKeys(candidate, ["status", "mode", "reason"]) &&
      candidate.mode === "dictionary-only" &&
      [
        "not-configured",
        "timeout",
        "invalid-output",
        "provider-failure",
        "deepseek-consent-required",
        "deepseek-timeout",
        "deepseek-invalid-output",
        "deepseek-provider-failure",
      ].includes(String(candidate.reason))
    );
  }
  if (
    candidate.status !== "available" ||
    (candidate.mode !== "local-ai" && candidate.mode !== "deepseek")
  ) {
    return false;
  }
  if (!hasOnlyKeys(candidate, ["status", "mode", "task", "result"])) {
    return false;
  }
  if (candidate.task === "translate") {
    return Boolean(parseWordLookupAiTranslation(candidate.result));
  }
  if (candidate.task !== "enrich") return false;
  if (typeof candidate.result !== "object" || candidate.result === null) {
    return false;
  }
  const result = candidate.result as Record<string, unknown>;
  return (
    hasOnlyKeys(result, ["senseId", "auxiliaryExample"]) &&
    nonEmptyString(result.senseId, 20) &&
    SENSE_ID_PATTERN.test(result.senseId) &&
    nonEmptyString(result.auxiliaryExample, 500)
  );
}
