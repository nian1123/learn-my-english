import "server-only";

import type {
  WordLookupAiEnrichment,
  WordLookupAiRequest,
  WordLookupAiTranslation,
} from "@/domain/word-lookup-ai";

import {
  requestOpenAiCompatibleWordLookup,
  WordLookupProviderError,
  type WordLookupProviderConfiguration,
} from "./openai-compatible-word-lookup";

const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;

export { WordLookupProviderError as LocalAiProviderError };

export function readLocalAiConfiguration(): WordLookupProviderConfiguration | null {
  const baseUrl = process.env.OPENAI_BASE_URL?.trim();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl, apiKey, model };
}

function providerTimeoutMs() {
  const configured = Number(process.env.OPENAI_TIMEOUT_MS);
  return Number.isInteger(configured) && configured >= 100 && configured <= 30_000
    ? configured
    : DEFAULT_PROVIDER_TIMEOUT_MS;
}

export function requestLocalAiWordLookup(
  configuration: WordLookupProviderConfiguration,
  request: WordLookupAiRequest,
  callerSignal?: AbortSignal,
): Promise<WordLookupAiEnrichment | WordLookupAiTranslation> {
  return requestOpenAiCompatibleWordLookup(configuration, request, {
    callerSignal,
    responseFormat: "json-schema",
    timeoutMs: providerTimeoutMs(),
  });
}
