import { parseDifficultSentenceAnalysisApiRequest } from "@/domain/difficult-sentence-ai";
import { readLocalAiConfiguration } from "@/server/local-ai-provider";
import { readDeepSeekConfiguration } from "@/server/deepseek-provider";
import {
  DifficultSentenceProviderError,
  requestOpenAiCompatibleDifficultSentence,
} from "@/server/openai-compatible-difficult-sentence";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

function timeoutMs(environmentName: "OPENAI_TIMEOUT_MS" | "DEEPSEEK_TIMEOUT_MS", fallback: number) {
  const configured = Number(process.env[environmentName]);
  return Number.isInteger(configured) && configured >= 100 && configured <= 30_000 ? configured : fallback;
}

export async function POST(request: Request) {
  let payload: unknown;
  try { payload = await request.json(); } catch {
    return Response.json({ error: "无效的 Difficult Sentence 请求" }, { status: 400, headers });
  }
  const parsed = parseDifficultSentenceAnalysisApiRequest(payload);
  if (!parsed) return Response.json({ error: "无效的 Difficult Sentence 请求" }, { status: 400, headers });
  let localReason: "not-configured" | "timeout" | "invalid-output" | "provider-failure" = "not-configured";
  const local = readLocalAiConfiguration();
  if (local) {
    try {
      const result = await requestOpenAiCompatibleDifficultSentence(local, parsed.analysis, {
        callerSignal: request.signal,
        responseFormat: "json-schema",
        timeoutMs: timeoutMs("OPENAI_TIMEOUT_MS", 15_000),
      });
      return Response.json({ status: "available", mode: "local-ai", result }, { headers });
    } catch (error) {
      if (request.signal.aborted) return new Response(null, { status: 499, headers });
      localReason = error instanceof DifficultSentenceProviderError ? error.reason : "provider-failure";
    }
  }
  const deepSeek = readDeepSeekConfiguration();
  if (!deepSeek) return Response.json({ status: "unavailable", reason: localReason }, { headers });
  if (!parsed.allowDeepSeekFallback) {
    return Response.json({ status: "unavailable", reason: "deepseek-consent-required" }, { headers });
  }
  try {
    const result = await requestOpenAiCompatibleDifficultSentence(deepSeek, parsed.analysis, {
      callerSignal: request.signal,
      responseFormat: "json-object",
      timeoutMs: timeoutMs("DEEPSEEK_TIMEOUT_MS", 5_000),
    });
    return Response.json({ status: "available", mode: "deepseek", result }, { headers });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499, headers });
    const reason = error instanceof DifficultSentenceProviderError ? error.reason : "provider-failure";
    return Response.json({ status: "unavailable", reason: `deepseek-${reason}` }, { headers });
  }
}
