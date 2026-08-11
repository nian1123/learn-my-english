import type { LearningSentenceId } from "./study-video";

export const WORD_LOOKUP_EXPLANATION_VERSION = "dictionary-v1";

export type LookupTextPart =
  | { kind: "word"; text: string; start: number; end: number }
  | { kind: "separator"; text: string; start: number; end: number };

export type WordLookupCandidate = {
  surfaceForm: string;
  normalizedForm: string;
};

export type WordLookupRequest = {
  sentenceId: LearningSentenceId;
  sentenceText: string;
  candidates: WordLookupCandidate[];
};

export type DictionaryDefinition = {
  definition: string;
  example?: string;
};

export type DictionaryMeaning = {
  partOfSpeech: string;
  definitions: DictionaryDefinition[];
};

export type DictionaryAudio = {
  url: string;
  sourceUrl?: string;
  license?: { name: string; url: string };
};

export type DictionaryEntry = {
  word: string;
  phonetic?: string;
  americanAudio?: DictionaryAudio;
  meanings: DictionaryMeaning[];
  sourceUrls: string[];
};

export type DictionaryLookupResult =
  | { status: "found"; entries: DictionaryEntry[] }
  | { status: "not-found" };

const WORD_PATTERN = /[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)*(?:-[\p{L}\p{N}]+)*/gu;
const EXPRESSION_PARTICLES = new Set([
  "about",
  "across",
  "after",
  "around",
  "at",
  "away",
  "back",
  "down",
  "for",
  "in",
  "into",
  "off",
  "on",
  "out",
  "over",
  "through",
  "to",
  "up",
  "with",
]);

const CONTRACTIONS: Record<string, string> = {
  "ain't": "is not",
  "aren't": "are not",
  "can't": "cannot",
  "couldn't": "could not",
  "didn't": "did not",
  "doesn't": "does not",
  "don't": "do not",
  "hadn't": "had not",
  "hasn't": "has not",
  "haven't": "have not",
  "he'd": "he would",
  "he'll": "he will",
  "he's": "he is",
  "i'd": "i would",
  "i'll": "i will",
  "i'm": "i am",
  "i've": "i have",
  "isn't": "is not",
  "it's": "it is",
  "let's": "let us",
  "mustn't": "must not",
  "she'd": "she would",
  "she'll": "she will",
  "she's": "she is",
  "shouldn't": "should not",
  "that's": "that is",
  "they'd": "they would",
  "they'll": "they will",
  "they're": "they are",
  "they've": "they have",
  "wasn't": "was not",
  "we'd": "we would",
  "we'll": "we will",
  "we're": "we are",
  "we've": "we have",
  "weren't": "were not",
  "what's": "what is",
  "where's": "where is",
  "who's": "who is",
  "won't": "will not",
  "wouldn't": "would not",
  "you'd": "you would",
  "you'll": "you will",
  "you're": "you are",
  "you've": "you have",
};

const COMMON_INFLECTIONS: Record<string, string> = {
  been: "be",
  better: "good",
  bought: "buy",
  came: "come",
  children: "child",
  did: "do",
  done: "do",
  feet: "foot",
  found: "find",
  gave: "give",
  gone: "go",
  got: "get",
  had: "have",
  has: "have",
  listening: "listen",
  made: "make",
  mice: "mouse",
  people: "person",
  practicing: "practice",
  ran: "run",
  said: "say",
  saw: "see",
  taken: "take",
  talking: "talk",
  thought: "think",
  took: "take",
  went: "go",
  were: "be",
  worse: "bad",
};

export class InvalidWordLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWordLookupError";
  }
}

export function tokenizeLookupText(text: string): LookupTextPart[] {
  const parts: LookupTextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(WORD_PATTERN)) {
    const start = match.index;
    if (start > cursor) {
      parts.push({
        kind: "separator",
        text: text.slice(cursor, start),
        start: cursor,
        end: start,
      });
    }
    const word = match[0];
    parts.push({ kind: "word", text: word, start, end: start + word.length });
    cursor = start + word.length;
  }
  if (cursor < text.length) {
    parts.push({
      kind: "separator",
      text: text.slice(cursor),
      start: cursor,
      end: text.length,
    });
  }
  return parts;
}

function normalizeApostrophe(value: string) {
  return value.replaceAll("’", "'").toLocaleLowerCase("en-US");
}

function normalizeInflection(word: string) {
  const common = COMMON_INFLECTIONS[word];
  if (common) return common;
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ing") && word.length > 5) {
    let stem = word.slice(0, -3);
    if (/([^aeiou])\1$/.test(stem)) stem = stem.slice(0, -1);
    return stem;
  }
  if (word.endsWith("ied") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ed") && word.length > 4) {
    let stem = word.slice(0, -2);
    if (/([^aeiou])\1$/.test(stem)) stem = stem.slice(0, -1);
    return stem;
  }
  if (word.endsWith("es") && /(ches|shes|sses|xes|zes)$/.test(word)) {
    return word.slice(0, -2);
  }
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export function normalizeDictionaryForm(surfaceForm: string) {
  const cleaned = surfaceForm
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (!cleaned) throw new InvalidWordLookupError("请选择英文单词或连续短语");
  if (cleaned.length > 80) {
    throw new InvalidWordLookupError("Word Lookup 最多支持 80 个字符");
  }

  return tokenizeLookupText(cleaned)
    .filter((part) => part.kind === "word")
    .flatMap((part) => {
      const word = normalizeApostrophe(part.text);
      const contraction = CONTRACTIONS[word];
      return (contraction ?? normalizeInflection(word)).split(" ");
    })
    .join(" ");
}

function addCandidate(
  candidates: WordLookupCandidate[],
  surfaceForm: string,
) {
  const candidate = {
    surfaceForm: surfaceForm.trim(),
    normalizedForm: normalizeDictionaryForm(surfaceForm),
  };
  if (
    !candidates.some(
      (existing) => existing.normalizedForm === candidate.normalizedForm,
    )
  ) {
    candidates.push(candidate);
  }
}

export function createWordLookupRequest(
  sentenceId: LearningSentenceId,
  sentenceText: string,
  surfaceForm: string,
  surfaceStart?: number,
): WordLookupRequest {
  const cleanedSurface = surfaceForm.trim();
  const candidates: WordLookupCandidate[] = [];
  addCandidate(candidates, cleanedSurface);

  if (!cleanedSurface.includes(" ") && surfaceStart !== undefined) {
    const words = tokenizeLookupText(sentenceText).filter(
      (part): part is Extract<LookupTextPart, { kind: "word" }> =>
        part.kind === "word",
    );
    const index = words.findIndex(
      (word) => word.start === surfaceStart && word.text === surfaceForm,
    );
    const previous = words[index - 1];
    const current = words[index];
    const next = words[index + 1];
    if (current && next && EXPRESSION_PARTICLES.has(normalizeApostrophe(next.text))) {
      addCandidate(candidates, `${current.text} ${next.text}`);
    }
    if (
      previous &&
      current &&
      EXPRESSION_PARTICLES.has(normalizeApostrophe(current.text))
    ) {
      addCandidate(candidates, `${previous.text} ${current.text}`);
    }
  }

  return { sentenceId, sentenceText, candidates };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isDictionaryLookupResult(
  value: unknown,
): value is DictionaryLookupResult {
  if (typeof value !== "object" || value === null || !("status" in value)) {
    return false;
  }
  if (value.status === "not-found") return true;
  if (value.status !== "found" || !("entries" in value)) return false;
  return (
    Array.isArray(value.entries) &&
    value.entries.length > 0 &&
    value.entries.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        "word" in entry &&
        isString(entry.word) &&
        "meanings" in entry &&
        Array.isArray(entry.meanings),
    )
  );
}
