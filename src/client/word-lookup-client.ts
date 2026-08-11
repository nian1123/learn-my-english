import {
  isDictionaryLookupResult,
  type DictionaryLookupResult,
  type WordLookupCandidate,
} from "@/domain/word-lookup";

import {
  readWordLookupCache,
  saveWordLookupCache,
} from "./word-lookup-cache";

export type LoadedWordLookup = {
  result: DictionaryLookupResult;
  source: "cache" | "provider";
};

export class WordLookupUnavailableError extends Error {
  constructor() {
    super("基础词典暂时不可用，也没有可用缓存");
    this.name = "WordLookupUnavailableError";
  }
}

export class WordLookupOfflineError extends Error {
  constructor() {
    super(
      "当前离线，而且没有这个 Word Lookup 的本地缓存。联网后可查询基础词典。",
    );
    this.name = "WordLookupOfflineError";
  }
}

export async function loadWordLookup(
  candidate: WordLookupCandidate,
  sentenceText: string,
  signal: AbortSignal,
): Promise<LoadedWordLookup> {
  const cached = await readWordLookupCache(candidate, sentenceText).catch(
    () => null,
  );
  if (cached) return { result: cached, source: "cache" };
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new WordLookupOfflineError();
  }

  let response: Response;
  try {
    response = await fetch(
      `/api/dictionary?term=${encodeURIComponent(candidate.normalizedForm)}`,
      { cache: "no-store", signal },
    );
  } catch (error) {
    if (signal.aborted) throw error;
    throw new WordLookupUnavailableError();
  }
  if (!response.ok) throw new WordLookupUnavailableError();

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new WordLookupUnavailableError();
  }
  if (!isDictionaryLookupResult(payload)) {
    throw new WordLookupUnavailableError();
  }

  await saveWordLookupCache(candidate, sentenceText, payload).catch(
    () => undefined,
  );
  return { result: payload, source: "provider" };
}
