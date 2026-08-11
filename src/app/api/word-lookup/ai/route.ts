import {
  parseWordLookupAiApiRequest,
  type WordLookupAiMode,
  type WordLookupAiRequest,
  type WordLookupAiResponse,
} from "@/domain/word-lookup-ai";
import {
  readLocalAiConfiguration,
  requestLocalAiWordLookup,
} from "@/server/local-ai-provider";
import {
  readDeepSeekConfiguration,
  requestDeepSeekWordLookup,
} from "@/server/deepseek-provider";
import { WordLookupProviderError } from "@/server/openai-compatible-word-lookup";

export const runtime = "nodejs";

const responseHeaders = { "Cache-Control": "no-store" };

type ProviderResult = Awaited<ReturnType<typeof requestLocalAiWordLookup>>;

function availableResponse(
  mode: WordLookupAiMode,
  request: WordLookupAiRequest,
  result: ProviderResult,
): WordLookupAiResponse {
  return request.task === "enrich"
    ? {
        status: "available",
        mode,
        task: "enrich",
        result: result as Extract<
          WordLookupAiResponse,
          { status: "available"; task: "enrich" }
        >["result"],
      }
    : {
        status: "available",
        mode,
        task: "translate",
        result: result as Extract<
          WordLookupAiResponse,
          { status: "available"; task: "translate" }
        >["result"],
      };
}

function unavailableResponse(
  reason: Extract<WordLookupAiResponse, { status: "unavailable" }>["reason"],
) {
  const response: WordLookupAiResponse = {
    status: "unavailable",
    mode: "dictionary-only",
    reason,
  };
  return Response.json(response, { headers: responseHeaders });
}

export async function POST(request: Request) {
  let requestPayload: unknown;
  try {
    requestPayload = await request.json();
  } catch {
    return Response.json(
      { error: "无效的 Word Lookup AI 请求" },
      { status: 400, headers: responseHeaders },
    );
  }
  const apiRequest = parseWordLookupAiApiRequest(requestPayload);
  if (!apiRequest) {
    return Response.json(
      { error: "无效的 Word Lookup AI 请求" },
      { status: 400, headers: responseHeaders },
    );
  }

  const { allowDeepSeekFallback, lookup: lookupRequest } = apiRequest;
  const localConfiguration = readLocalAiConfiguration();
  let localFailure: "not-configured" | "timeout" | "invalid-output" | "provider-failure" =
    "not-configured";

  if (localConfiguration) {
    try {
      const result = await requestLocalAiWordLookup(
        localConfiguration,
        lookupRequest,
        request.signal,
      );
      return Response.json(availableResponse("local-ai", lookupRequest, result), {
        headers: responseHeaders,
      });
    } catch (error) {
      if (request.signal.aborted) {
        return new Response(null, { status: 499, headers: responseHeaders });
      }
      localFailure =
        error instanceof WordLookupProviderError
          ? error.reason
          : "provider-failure";
    }
  }

  const deepSeekConfiguration = readDeepSeekConfiguration();
  if (!deepSeekConfiguration) return unavailableResponse(localFailure);
  if (!allowDeepSeekFallback) {
    return unavailableResponse("deepseek-consent-required");
  }

  try {
    const result = await requestDeepSeekWordLookup(
      deepSeekConfiguration,
      lookupRequest,
      request.signal,
    );
    return Response.json(availableResponse("deepseek", lookupRequest, result), {
      headers: responseHeaders,
    });
  } catch (error) {
    if (request.signal.aborted) {
      return new Response(null, { status: 499, headers: responseHeaders });
    }
    const reason =
      error instanceof WordLookupProviderError
        ? error.reason
        : "provider-failure";
    return unavailableResponse(`deepseek-${reason}`);
  }
}
