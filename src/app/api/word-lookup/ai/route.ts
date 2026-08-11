import {
  parseWordLookupAiRequest,
  type WordLookupAiResponse,
} from "@/domain/word-lookup-ai";
import {
  LocalAiProviderError,
  readLocalAiConfiguration,
  requestLocalAiWordLookup,
} from "@/server/local-ai-provider";

export const runtime = "nodejs";

const responseHeaders = { "Cache-Control": "no-store" };

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
  const lookupRequest = parseWordLookupAiRequest(requestPayload);
  if (!lookupRequest) {
    return Response.json(
      { error: "无效的 Word Lookup AI 请求" },
      { status: 400, headers: responseHeaders },
    );
  }

  const configuration = readLocalAiConfiguration();
  if (!configuration) {
    const response: WordLookupAiResponse = {
      status: "unavailable",
      mode: "dictionary-only",
      reason: "not-configured",
    };
    return Response.json(response, { headers: responseHeaders });
  }

  try {
    const result = await requestLocalAiWordLookup(
      configuration,
      lookupRequest,
      request.signal,
    );
    const response: WordLookupAiResponse =
      lookupRequest.task === "enrich"
        ? {
            status: "available",
            mode: "local-ai",
            task: "enrich",
            result: result as Extract<
              WordLookupAiResponse,
              { status: "available"; task: "enrich" }
            >["result"],
          }
        : {
            status: "available",
            mode: "local-ai",
            task: "translate",
            result: result as Extract<
              WordLookupAiResponse,
              { status: "available"; task: "translate" }
            >["result"],
          };
    return Response.json(response, { headers: responseHeaders });
  } catch (error) {
    if (request.signal.aborted) {
      return new Response(null, { status: 499, headers: responseHeaders });
    }
    const response: WordLookupAiResponse = {
      status: "unavailable",
      mode: "dictionary-only",
      reason:
        error instanceof LocalAiProviderError
          ? error.reason
          : "provider-failure",
    };
    return Response.json(response, { headers: responseHeaders });
  }
}
