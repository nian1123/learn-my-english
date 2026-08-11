import {
  dictionarySenseOptions,
  isWordLookupAiResponse,
  parseWordLookupAiEnrichment,
  type WordLookupAiResponse,
} from "./word-lookup-ai";
import {
  isDictionaryLookupResult,
  type DictionaryLookupResult,
  type WordLookupCandidate,
} from "./word-lookup";
import type { LearningSentenceId, StudyVideoId } from "./study-video";

type FoundDictionaryResult = Extract<
  DictionaryLookupResult,
  { status: "found" }
>;

type AvailableEnrichment = Extract<
  WordLookupAiResponse,
  { status: "available"; task: "enrich" }
>;

type AvailableTranslation = Extract<
  WordLookupAiResponse,
  { status: "available"; task: "translate" }
>;

export type WordBankOrigin = {
  studyVideoId: StudyVideoId;
  studyVideoTitle: string;
  studyVideoChannel: string;
  studyVideoThumbnailUrl: string;
  learningSentenceId: LearningSentenceId;
  sentenceText: string;
  startSeconds: number;
  endSeconds: number;
};

export type WordBankEntry = {
  schemaVersion: 1;
  id: string;
  savedAt: string;
  expression: WordLookupCandidate;
  origin: WordBankOrigin;
  lookup: {
    dictionary: FoundDictionaryResult;
    selectedSenseId: string;
    enrichment?: AvailableEnrichment;
    translation?: AvailableTranslation;
  };
};

export function wordBankEntryIdFor(
  origin: Pick<WordBankOrigin, "studyVideoId" | "learningSentenceId">,
  candidate: WordLookupCandidate,
) {
  return JSON.stringify([
    "word-bank-v1",
    origin.studyVideoId,
    origin.learningSentenceId,
    candidate.normalizedForm.toLocaleLowerCase("en-US"),
  ]);
}

export function createWordBankEntry({
  candidate,
  dictionary,
  enrichment,
  origin,
  savedAt = new Date().toISOString(),
  translation,
}: {
  candidate: WordLookupCandidate;
  dictionary: FoundDictionaryResult;
  enrichment?: AvailableEnrichment;
  origin: WordBankOrigin;
  savedAt?: string;
  translation?: AvailableTranslation;
}): WordBankEntry | null {
  const senses = dictionarySenseOptions(dictionary);
  const validEnrichment =
    enrichment && parseWordLookupAiEnrichment(enrichment.result, senses)
      ? enrichment
      : undefined;
  const selectedSenseId = validEnrichment?.result.senseId ?? senses[0]?.id;
  if (!selectedSenseId) return null;

  return {
    schemaVersion: 1,
    id: wordBankEntryIdFor(origin, candidate),
    savedAt,
    expression: candidate,
    origin,
    lookup: {
      dictionary,
      selectedSenseId,
      ...(validEnrichment ? { enrichment: validEnrichment } : {}),
      ...(translation ? { translation } : {}),
    },
  };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

export function isWordBankEntry(value: unknown): value is WordBankEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<WordBankEntry>;
  const expression = candidate.expression as Partial<WordLookupCandidate> | undefined;
  const origin = candidate.origin as Partial<WordBankOrigin> | undefined;
  const lookup = candidate.lookup as Partial<WordBankEntry["lookup"]> | undefined;
  if (
    candidate.schemaVersion !== 1 ||
    !nonEmptyString(candidate.id) ||
    !nonEmptyString(candidate.savedAt) ||
    !expression ||
    !nonEmptyString(expression.surfaceForm) ||
    !nonEmptyString(expression.normalizedForm) ||
    !origin ||
    !nonEmptyString(origin.studyVideoId) ||
    !nonEmptyString(origin.studyVideoTitle) ||
    !nonEmptyString(origin.studyVideoChannel) ||
    typeof origin.studyVideoThumbnailUrl !== "string" ||
    !nonEmptyString(origin.learningSentenceId) ||
    !nonEmptyString(origin.sentenceText) ||
    typeof origin.startSeconds !== "number" ||
    !Number.isFinite(origin.startSeconds) ||
    typeof origin.endSeconds !== "number" ||
    !Number.isFinite(origin.endSeconds) ||
    origin.startSeconds < 0 ||
    origin.endSeconds <= origin.startSeconds ||
    !lookup ||
    !isDictionaryLookupResult(lookup.dictionary) ||
    lookup.dictionary.status !== "found" ||
    !nonEmptyString(lookup.selectedSenseId)
  ) {
    return false;
  }

  const senses = dictionarySenseOptions(lookup.dictionary);
  if (!senses.some((sense) => sense.id === lookup.selectedSenseId)) return false;
  if (
    lookup.enrichment !== undefined &&
    (!isWordLookupAiResponse(lookup.enrichment) ||
      lookup.enrichment.status !== "available" ||
      lookup.enrichment.task !== "enrich" ||
      !parseWordLookupAiEnrichment(lookup.enrichment.result, senses))
  ) {
    return false;
  }
  if (
    lookup.translation !== undefined &&
    (!isWordLookupAiResponse(lookup.translation) ||
      lookup.translation.status !== "available" ||
      lookup.translation.task !== "translate")
  ) {
    return false;
  }
  return candidate.id === wordBankEntryIdFor(origin as WordBankOrigin, expression as WordLookupCandidate);
}

export function selectedWordBankSense(entry: WordBankEntry) {
  return dictionarySenseOptions(entry.lookup.dictionary).find(
    (sense) => sense.id === entry.lookup.selectedSenseId,
  );
}

export function selectedWordBankDictionaryEntry(entry: WordBankEntry) {
  const entryIndex = Number.parseInt(entry.lookup.selectedSenseId.split(":")[0], 10);
  return entry.lookup.dictionary.entries[entryIndex];
}
