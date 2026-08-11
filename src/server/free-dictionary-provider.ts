import "server-only";

import type {
  DictionaryAudio,
  DictionaryEntry,
  DictionaryLookupResult,
  DictionaryMeaning,
} from "@/domain/word-lookup";

const PROVIDER_TIMEOUT_MS = 4_000;
const MAXIMUM_PROVIDER_RESPONSE_LENGTH = 1_000_000;

type ProviderPhonetic = {
  text?: unknown;
  audio?: unknown;
  sourceUrl?: unknown;
  license?: { name?: unknown; url?: unknown };
};

type ProviderEntry = {
  word?: unknown;
  phonetic?: unknown;
  phonetics?: unknown;
  meanings?: unknown;
  sourceUrls?: unknown;
};

export class DictionaryProviderUnavailableError extends Error {
  constructor() {
    super("Free Dictionary API is unavailable");
    this.name = "DictionaryProviderUnavailableError";
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function safeHttpUrl(value: unknown): string | undefined {
  if (!nonEmptyString(value)) return undefined;
  const candidate = value.startsWith("//") ? `https:${value}` : value;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function isConfirmedAmericanAudio(url: string) {
  const path = new URL(url).pathname.toLocaleLowerCase("en-US");
  return (
    /(?:^|[-_.\/])(?:en-)?us(?:[-_.\/]|$)/.test(path) ||
    path.includes("american")
  );
}

function dictionaryAudio(phonetic: ProviderPhonetic): DictionaryAudio | undefined {
  const url = safeHttpUrl(phonetic.audio);
  if (!url || !isConfirmedAmericanAudio(url)) return undefined;
  const sourceUrl = safeHttpUrl(phonetic.sourceUrl);
  const licenseName = phonetic.license?.name;
  const licenseUrl = safeHttpUrl(phonetic.license?.url);
  return {
    url,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(nonEmptyString(licenseName) && licenseUrl
      ? { license: { name: licenseName, url: licenseUrl } }
      : {}),
  };
}

function dictionaryMeanings(value: unknown): DictionaryMeaning[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((meaning) => {
    if (typeof meaning !== "object" || meaning === null) return [];
    const candidate = meaning as {
      partOfSpeech?: unknown;
      definitions?: unknown;
    };
    if (!nonEmptyString(candidate.partOfSpeech)) return [];
    if (!Array.isArray(candidate.definitions)) return [];
    const definitions = candidate.definitions.flatMap((definition) => {
      if (typeof definition !== "object" || definition === null) return [];
      const item = definition as { definition?: unknown; example?: unknown };
      if (!nonEmptyString(item.definition)) return [];
      return [
        {
          definition: item.definition.trim(),
          ...(nonEmptyString(item.example)
            ? { example: item.example.trim() }
            : {}),
        },
      ];
    });
    return definitions.length
      ? [{ partOfSpeech: candidate.partOfSpeech.trim(), definitions }]
      : [];
  });
}

function dictionaryEntry(value: unknown): DictionaryEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as ProviderEntry;
  if (!nonEmptyString(candidate.word)) return null;
  const meanings = dictionaryMeanings(candidate.meanings);
  if (!meanings.length) return null;
  const phonetics = Array.isArray(candidate.phonetics)
    ? (candidate.phonetics.filter(
        (phonetic): phonetic is ProviderPhonetic =>
          typeof phonetic === "object" && phonetic !== null,
      ) as ProviderPhonetic[])
    : [];
  const americanPhonetic = phonetics.find((phonetic) =>
    dictionaryAudio(phonetic),
  );
  const americanAudio = americanPhonetic
    ? dictionaryAudio(americanPhonetic)
    : undefined;
  const fallbackPhonetic = phonetics.find((item) =>
    nonEmptyString(item.text),
  )?.text;
  const phonetic = nonEmptyString(americanPhonetic?.text)
    ? americanPhonetic.text.trim()
    : nonEmptyString(candidate.phonetic)
      ? candidate.phonetic.trim()
      : nonEmptyString(fallbackPhonetic)
        ? fallbackPhonetic.trim()
        : undefined;
  const sourceUrls = Array.isArray(candidate.sourceUrls)
    ? candidate.sourceUrls.flatMap((url) => {
        const safe = safeHttpUrl(url);
        return safe ? [safe] : [];
      })
    : [];

  return {
    word: candidate.word.trim(),
    meanings,
    sourceUrls,
    ...(phonetic ? { phonetic } : {}),
    ...(americanAudio ? { americanAudio } : {}),
  };
}

export async function lookupFreeDictionary(
  normalizedForm: string,
): Promise<DictionaryLookupResult> {
  const baseUrl =
    process.env.DICTIONARY_API_BASE_URL?.trim() ||
    "https://api.dictionaryapi.dev";

  let response: Response;
  try {
    response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/api/v2/entries/en/${encodeURIComponent(normalizedForm)}`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      },
    );
  } catch {
    throw new DictionaryProviderUnavailableError();
  }

  if (response.status === 404) return { status: "not-found" };
  if (!response.ok) throw new DictionaryProviderUnavailableError();

  let responseText: string;
  try {
    responseText = await response.text();
  } catch {
    throw new DictionaryProviderUnavailableError();
  }
  if (responseText.length > MAXIMUM_PROVIDER_RESPONSE_LENGTH) {
    throw new DictionaryProviderUnavailableError();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new DictionaryProviderUnavailableError();
  }
  if (!Array.isArray(payload)) throw new DictionaryProviderUnavailableError();
  const entries = payload.flatMap((item) => {
    const entry = dictionaryEntry(item);
    return entry ? [entry] : [];
  });
  if (!entries.length) throw new DictionaryProviderUnavailableError();
  return { status: "found", entries };
}
