import "server-only";

import type {
  WordLookupAiEnrichment,
  WordLookupAiRequest,
  WordLookupAiTranslation,
} from "@/domain/word-lookup-ai";

import {
  requestOpenAiCompatibleWordLookup,
  type WordLookupProviderConfiguration,
} from "./openai-compatible-word-lookup";

const DEFAULT_DEEPSEEK_TIMEOUT_MS = 5_000;

export function readDeepSeekConfiguration(): WordLookupProviderConfiguration | null {
  const baseUrl = process.env.DEEPSEEK_BASE_URL?.trim();
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const model = process.env.DEEPSEEK_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl, apiKey, model };
}

function providerTimeoutMs() {
  const configured = Number(process.env.DEEPSEEK_TIMEOUT_MS);
  return Number.isInteger(configured) && configured >= 100 && configured <= 30_000
    ? configured
    : DEFAULT_DEEPSEEK_TIMEOUT_MS;
}

export function requestDeepSeekWordLookup(
  configuration: WordLookupProviderConfiguration,
  request: WordLookupAiRequest,
  callerSignal?: AbortSignal,
): Promise<WordLookupAiEnrichment | WordLookupAiTranslation> {
  return requestOpenAiCompatibleWordLookup(configuration, request, {
    callerSignal,
    responseFormat: "json-object",
    timeoutMs: providerTimeoutMs(),
  });
}
