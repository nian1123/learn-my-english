import {
  createWordLookupAiRequest,
  isWordLookupAiResponse,
  parseWordLookupAiEnrichment,
  type WordLookupAiResponse,
} from "@/domain/word-lookup-ai";
import type {
  DictionaryLookupResult,
  WordLookupCandidate,
} from "@/domain/word-lookup";

import {
  readWordLookupAiCache,
  saveWordLookupAiCache,
} from "./word-lookup-ai-cache";

export type LoadedWordLookupAi = {
  response: WordLookupAiResponse;
  source: "cache" | "provider";
};

function unavailable(
  reason: Extract<WordLookupAiResponse, { status: "unavailable" }>["reason"],
): LoadedWordLookupAi {
  return {
    source: "provider",
    response: { status: "unavailable", mode: "dictionary-only", reason },
  };
}

async function requestWordLookupAi(
  payload: ReturnType<typeof createWordLookupAiRequest>,
  signal: AbortSignal,
): Promise<WordLookupAiResponse> {
  let response: Response;
  try {
    response = await fetch("/api/word-lookup/ai", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    return { status: "unavailable", mode: "dictionary-only", reason: "provider-failure" };
  }
  if (!response.ok) {
    return { status: "unavailable", mode: "dictionary-only", reason: "provider-failure" };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "unavailable", mode: "dictionary-only", reason: "invalid-output" };
  }
  return isWordLookupAiResponse(body)
    ? body
    : { status: "unavailable", mode: "dictionary-only", reason: "invalid-output" };
}

export async function loadWordLookupAiEnrichment(
  candidate: WordLookupCandidate,
  sentenceText: string,
  dictionaryResult: Extract<DictionaryLookupResult, { status: "found" }>,
  signal: AbortSignal,
): Promise<LoadedWordLookupAi> {
  const payload = createWordLookupAiRequest(
    "enrich",
    candidate,
    sentenceText,
    dictionaryResult,
  );
  const cached = await readWordLookupAiCache(
    "enrich",
    candidate,
    sentenceText,
  ).catch(() => null);
  if (
    cached?.task === "enrich" &&
    parseWordLookupAiEnrichment(cached.result, payload.senses)
  ) {
    return { response: cached, source: "cache" };
  }

  const response = await requestWordLookupAi(payload, signal);
  if (response.status !== "available") {
    return { response, source: "provider" };
  }
  if (
    response.task !== "enrich" ||
    !parseWordLookupAiEnrichment(response.result, payload.senses)
  ) {
    return unavailable("invalid-output");
  }
  await saveWordLookupAiCache(
    "enrich",
    candidate,
    sentenceText,
    response,
  ).catch(() => undefined);
  return { response, source: "provider" };
}

export async function loadWordLookupAiTranslation(
  candidate: WordLookupCandidate,
  sentenceText: string,
  dictionaryResult: Extract<DictionaryLookupResult, { status: "found" }>,
  selectedSenseId: string,
  signal: AbortSignal,
): Promise<LoadedWordLookupAi> {
  const payload = createWordLookupAiRequest(
    "translate",
    candidate,
    sentenceText,
    dictionaryResult,
    selectedSenseId,
  );
  const cached = await readWordLookupAiCache(
    "translate",
    candidate,
    sentenceText,
    selectedSenseId,
  ).catch(() => null);
  if (cached?.task === "translate") {
    return { response: cached, source: "cache" };
  }

  const response = await requestWordLookupAi(payload, signal);
  if (response.status !== "available") {
    return { response, source: "provider" };
  }
  if (response.task !== "translate") return unavailable("invalid-output");
  await saveWordLookupAiCache(
    "translate",
    candidate,
    sentenceText,
    response,
    selectedSenseId,
  ).catch(() => undefined);
  return { response, source: "provider" };
}
