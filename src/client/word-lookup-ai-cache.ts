import {
  isWordLookupAiResponse,
  LOCAL_AI_WORD_LOOKUP_VERSION,
  type WordLookupAiResponse,
  type WordLookupAiTask,
} from "@/domain/word-lookup-ai";
import type { WordLookupCandidate } from "@/domain/word-lookup";

import {
  LEARNING_STORES,
  openLearningDatabase,
  requestResult,
  transactionCompleted,
} from "./learning-database";

type AvailableWordLookupAiResponse = Extract<
  WordLookupAiResponse,
  { status: "available" }
>;

export type CachedWordLookupAi = {
  cacheKey: string;
  explanationVersion: string;
  cachedAt: string;
  response: AvailableWordLookupAiResponse;
};

function normalizedContext(sentenceText: string) {
  return sentenceText.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function wordLookupAiCacheKey(
  task: WordLookupAiTask,
  candidate: WordLookupCandidate,
  sentenceText: string,
  selectedSenseId?: string,
) {
  return JSON.stringify([
    LOCAL_AI_WORD_LOOKUP_VERSION,
    task,
    candidate.normalizedForm.toLocaleLowerCase("en-US"),
    normalizedContext(sentenceText),
    selectedSenseId ?? null,
  ]);
}

export function isCachedWordLookupAi(
  value: unknown,
): value is CachedWordLookupAi {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CachedWordLookupAi>;
  return (
    typeof candidate.cacheKey === "string" &&
    candidate.explanationVersion === LOCAL_AI_WORD_LOOKUP_VERSION &&
    typeof candidate.cachedAt === "string" &&
    isWordLookupAiResponse(candidate.response) &&
    candidate.response.status === "available"
  );
}

export async function readWordLookupAiCache(
  task: WordLookupAiTask,
  candidate: WordLookupCandidate,
  sentenceText: string,
  selectedSenseId?: string,
): Promise<AvailableWordLookupAiResponse | null> {
  const database = await openLearningDatabase();
  const cacheKey = wordLookupAiCacheKey(
    task,
    candidate,
    sentenceText,
    selectedSenseId,
  );
  try {
    const transaction = database.transaction(
      LEARNING_STORES.wordLookups,
      "readonly",
    );
    const stored = await requestResult(
      transaction.objectStore(LEARNING_STORES.wordLookups).get(cacheKey),
    );
    return isCachedWordLookupAi(stored) && stored.response.task === task
      ? stored.response
      : null;
  } finally {
    database.close();
  }
}

export async function saveWordLookupAiCache(
  task: WordLookupAiTask,
  candidate: WordLookupCandidate,
  sentenceText: string,
  response: AvailableWordLookupAiResponse,
  selectedSenseId?: string,
): Promise<void> {
  const database = await openLearningDatabase();
  const cacheKey = wordLookupAiCacheKey(
    task,
    candidate,
    sentenceText,
    selectedSenseId,
  );
  try {
    const transaction = database.transaction(
      LEARNING_STORES.wordLookups,
      "readwrite",
    );
    const cached: CachedWordLookupAi = {
      cacheKey,
      explanationVersion: LOCAL_AI_WORD_LOOKUP_VERSION,
      cachedAt: new Date().toISOString(),
      response,
    };
    transaction.objectStore(LEARNING_STORES.wordLookups).put(cached, cacheKey);
    await transactionCompleted(transaction);
  } finally {
    database.close();
  }
}
