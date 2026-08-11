import type {
  DictionaryLookupResult,
  WordLookupCandidate,
} from "@/domain/word-lookup";
import {
  isDictionaryLookupResult,
  WORD_LOOKUP_EXPLANATION_VERSION,
} from "@/domain/word-lookup";

import {
  LEARNING_STORES,
  openLearningDatabase,
  requestResult,
  transactionCompleted,
} from "./learning-database";

export type CachedWordLookup = {
  cacheKey: string;
  explanationVersion: string;
  cachedAt: string;
  result: DictionaryLookupResult;
};

function normalizedContext(sentenceText: string) {
  return sentenceText.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function wordLookupCacheKey(
  candidate: WordLookupCandidate,
  sentenceText: string,
) {
  return JSON.stringify([
    WORD_LOOKUP_EXPLANATION_VERSION,
    candidate.normalizedForm.toLocaleLowerCase("en-US"),
    normalizedContext(sentenceText),
  ]);
}

export function isCachedWordLookup(value: unknown): value is CachedWordLookup {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CachedWordLookup>;
  return (
    typeof candidate.cacheKey === "string" &&
    candidate.explanationVersion === WORD_LOOKUP_EXPLANATION_VERSION &&
    typeof candidate.cachedAt === "string" &&
    isDictionaryLookupResult(candidate.result)
  );
}

export async function readWordLookupCache(
  candidate: WordLookupCandidate,
  sentenceText: string,
): Promise<DictionaryLookupResult | null> {
  const database = await openLearningDatabase();
  const cacheKey = wordLookupCacheKey(candidate, sentenceText);

  try {
    const transaction = database.transaction(
      LEARNING_STORES.wordLookups,
      "readonly",
    );
    const stored = await requestResult(
      transaction.objectStore(LEARNING_STORES.wordLookups).get(cacheKey),
    );
    return isCachedWordLookup(stored) ? stored.result : null;
  } finally {
    database.close();
  }
}

export async function saveWordLookupCache(
  candidate: WordLookupCandidate,
  sentenceText: string,
  result: DictionaryLookupResult,
): Promise<void> {
  const database = await openLearningDatabase();
  const cacheKey = wordLookupCacheKey(candidate, sentenceText);

  try {
    const transaction = database.transaction(
      LEARNING_STORES.wordLookups,
      "readwrite",
    );
    const cached: CachedWordLookup = {
      cacheKey,
      explanationVersion: WORD_LOOKUP_EXPLANATION_VERSION,
      cachedAt: new Date().toISOString(),
      result,
    };
    transaction.objectStore(LEARNING_STORES.wordLookups).put(cached, cacheKey);
    await transactionCompleted(transaction);
  } finally {
    database.close();
  }
}
