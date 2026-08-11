import {
  InvalidWordLookupError,
  normalizeDictionaryForm,
} from "@/domain/word-lookup";
import {
  DictionaryProviderUnavailableError,
  lookupFreeDictionary,
} from "@/server/free-dictionary-provider";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const term = new URL(request.url).searchParams.get("term") ?? "";

  try {
    const normalizedForm = normalizeDictionaryForm(term);
    const result = await lookupFreeDictionary(normalizedForm);
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof InvalidWordLookupError) {
      return Response.json(
        { error: error.message },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (error instanceof DictionaryProviderUnavailableError) {
      return Response.json(
        { error: "基础词典暂时不可用" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }
}
