import {
  isWordLookupAiResponse,
  LOCAL_AI_WORD_LOOKUP_VERSION,
} from "@/domain/word-lookup-ai";
import {
  isWordBankEntry,
  type WordBankEntry,
} from "@/domain/word-bank";
import {
  WORD_LOOKUP_EXPLANATION_VERSION,
  type DictionaryAudio,
  type DictionaryDefinition,
  type DictionaryEntry,
  type DictionaryLookupResult,
  type DictionaryMeaning,
} from "@/domain/word-lookup";
import {
  isDifficultSentence,
  type DifficultSentence,
} from "@/domain/difficult-sentence";
import type {
  CaptionCue,
  CaptionSource,
  LearningSentence,
  LocalRevisionSentence,
  StudyVideo,
} from "@/domain/study-video";

import {
  DEFAULT_LEARNER_PREFERENCES,
  isLearnerPreferences,
  LEARNER_PREFERENCE_KEY,
  type LearnerPreferences,
} from "./learner-preferences";
import {
  LEARNING_STORES,
  LocalPersistenceUnavailableError,
  openLearningDatabase,
  requestResult,
  transactionCompleted,
} from "./learning-database";
import {
  isCachedWordLookupAi,
  type CachedWordLookupAi,
} from "./word-lookup-ai-cache";
import {
  isCachedWordLookup,
  type CachedWordLookup,
} from "./word-lookup-cache";

export const LOCAL_LEARNING_BACKUP_SCHEMA_VERSION = 2;
export const LOCAL_LEARNING_BACKUP_MAXIMUM_BYTES = 25_000_000;

export type BackupWordLookup = {
  key: string;
  value: CachedWordLookup | CachedWordLookupAi;
};

export type LocalLearningBackup = {
  application: "learn-my-english";
  backupSchemaVersion: 2;
  exportedAt: string;
  data: {
    preferences: LearnerPreferences;
    studyLibrary: StudyVideo[];
    wordLookups: BackupWordLookup[];
    wordBank: WordBankEntry[];
    difficultSentences: DifficultSentence[];
  };
};

export type LocalLearningRestoreMode = "merge" | "replace";

export type LocalLearningBackupParseResult =
  | { status: "valid"; backup: LocalLearningBackup }
  | {
      status: "invalid";
      reason: "invalid-json" | "invalid-data" | "too-large" | "unsupported-schema";
    };

export class LocalLearningBackupConflictError extends Error {
  constructor() {
    super("Backup conflicts with current local learning data");
    this.name = "LocalLearningBackupConflictError";
  }
}

export class LocalLearningBackupValidationError extends Error {
  constructor(message = "Local learning data cannot produce a valid backup") {
    super(message);
    this.name = "LocalLearningBackupValidationError";
  }
}

type PlainRecord = Record<string, unknown>;

type LegacyLocalLearningBackup = {
  application: "learn-my-english";
  backupSchemaVersion: 1;
  exportedAt: string;
  data: {
    preferences: LearnerPreferences;
    studyLibrary: StudyVideo[];
    wordLookups: BackupWordLookup[];
    wordBank: WordBankEntry[];
  };
};

function isRecord(value: unknown): value is PlainRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: PlainRecord,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
) {
  const keys = Object.keys(value);
  return (
    requiredKeys.every((key) => Object.hasOwn(value, key)) &&
    keys.every(
      (key) => requiredKeys.includes(key) || optionalKeys.includes(key),
    )
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isRemoteUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function hasUniqueStrings(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function isStrictDictionaryDefinition(
  value: unknown,
): value is DictionaryDefinition {
  if (!isRecord(value) || !hasExactKeys(value, ["definition"], ["example"])) {
    return false;
  }
  return (
    isNonEmptyString(value.definition) &&
    (value.example === undefined || isNonEmptyString(value.example))
  );
}

function isStrictDictionaryMeaning(value: unknown): value is DictionaryMeaning {
  if (!isRecord(value) || !hasExactKeys(value, ["partOfSpeech", "definitions"])) {
    return false;
  }
  return (
    isNonEmptyString(value.partOfSpeech) &&
    Array.isArray(value.definitions) &&
    value.definitions.length > 0 &&
    value.definitions.every(isStrictDictionaryDefinition)
  );
}

function isStrictDictionaryAudio(value: unknown): value is DictionaryAudio {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["url"], ["license", "sourceUrl"]) ||
    !isRemoteUrl(value.url) ||
    (value.sourceUrl !== undefined && !isRemoteUrl(value.sourceUrl))
  ) {
    return false;
  }
  if (value.license === undefined) return true;
  return (
    isRecord(value.license) &&
    hasExactKeys(value.license, ["name", "url"]) &&
    isNonEmptyString(value.license.name) &&
    isRemoteUrl(value.license.url)
  );
}

function isStrictDictionaryEntry(value: unknown): value is DictionaryEntry {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      ["word", "meanings", "sourceUrls"],
      ["americanAudio", "phonetic"],
    )
  ) {
    return false;
  }
  return (
    isNonEmptyString(value.word) &&
    (value.phonetic === undefined || isNonEmptyString(value.phonetic)) &&
    (value.americanAudio === undefined ||
      isStrictDictionaryAudio(value.americanAudio)) &&
    Array.isArray(value.meanings) &&
    value.meanings.length > 0 &&
    value.meanings.every(isStrictDictionaryMeaning) &&
    Array.isArray(value.sourceUrls) &&
    value.sourceUrls.every(isRemoteUrl)
  );
}

function isStrictDictionaryLookupResult(
  value: unknown,
): value is DictionaryLookupResult {
  if (!isRecord(value)) return false;
  if (value.status === "not-found") {
    return hasExactKeys(value, ["status"]);
  }
  return (
    value.status === "found" &&
    hasExactKeys(value, ["status", "entries"]) &&
    Array.isArray(value.entries) &&
    value.entries.length > 0 &&
    value.entries.every(isStrictDictionaryEntry)
  );
}

function isStrictCaptionCue(
  value: unknown,
  durationSeconds: number,
): value is CaptionCue {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["id", "startSeconds", "endSeconds", "text"])
  ) {
    return false;
  }
  return (
    isNonEmptyString(value.id) &&
    isFiniteNumber(value.startSeconds) &&
    isFiniteNumber(value.endSeconds) &&
    value.startSeconds >= 0 &&
    value.endSeconds > value.startSeconds &&
    value.endSeconds <= durationSeconds &&
    isNonEmptyString(value.text)
  );
}

function isStrictCaptionSource(
  value: unknown,
  youtubeVideoId: string,
  durationSeconds: number,
): value is CaptionSource {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["id", "kind", "format", "fileName", "cues"]) ||
    value.id !== `caption-${youtubeVideoId}` ||
    ![
      "auto-generated",
      "learner-supplied",
      "manual",
      "platform-provided",
    ].includes(
      String(value.kind),
    ) ||
    (value.format !== "srt" && value.format !== "vtt") ||
    typeof value.fileName !== "string" ||
    !Array.isArray(value.cues) ||
    value.cues.length === 0 ||
    !value.cues.every((cue) => isStrictCaptionCue(cue, durationSeconds))
  ) {
    return false;
  }
  return hasUniqueStrings(
    value.cues.map((cue) => (cue as CaptionCue).id as string),
  );
}

function isStrictLearningSentence(
  value: unknown,
  captionSourceId: string,
  cueIds: ReadonlySet<string>,
  durationSeconds: number,
  localRevision: boolean,
): value is LearningSentence | LocalRevisionSentence {
  const requiredKeys = [
    "id",
    "captionSourceId",
    "sourceCueIds",
    "startSeconds",
    "endSeconds",
    "text",
    ...(localRevision ? ["originalSentenceIds"] : []),
  ];
  if (!isRecord(value) || !hasExactKeys(value, requiredKeys)) return false;
  if (
    !isNonEmptyString(value.id) ||
    value.captionSourceId !== captionSourceId ||
    !Array.isArray(value.sourceCueIds) ||
    value.sourceCueIds.length === 0 ||
    !value.sourceCueIds.every(
      (cueId) => typeof cueId === "string" && cueIds.has(cueId),
    ) ||
    !isFiniteNumber(value.startSeconds) ||
    !isFiniteNumber(value.endSeconds) ||
    value.startSeconds < 0 ||
    value.endSeconds <= value.startSeconds ||
    value.endSeconds > durationSeconds ||
    !isNonEmptyString(value.text)
  ) {
    return false;
  }
  return (
    !localRevision ||
    (Array.isArray(value.originalSentenceIds) &&
      value.originalSentenceIds.length > 0 &&
      value.originalSentenceIds.every(isNonEmptyString))
  );
}

function isStrictStudyVideo(value: unknown): value is StudyVideo {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      [
        "schemaVersion",
        "id",
        "youtubeVideoId",
        "title",
        "channel",
        "thumbnailUrl",
        "durationSeconds",
        "lastPositionSeconds",
        "lastStudiedAt",
        "captionSource",
        "learningSentences",
      ],
      ["localRevision"],
    ) ||
    value.schemaVersion !== 1 ||
    typeof value.youtubeVideoId !== "string" ||
    !/^[A-Za-z0-9_-]{11}$/.test(value.youtubeVideoId) ||
    value.id !== `study-video-${value.youtubeVideoId}` ||
    !isNonEmptyString(value.title) ||
    !isNonEmptyString(value.channel) ||
    !isRemoteUrl(value.thumbnailUrl) ||
    !isFiniteNumber(value.durationSeconds) ||
    value.durationSeconds <= 0 ||
    value.durationSeconds > 10_800 ||
    !isFiniteNumber(value.lastPositionSeconds) ||
    value.lastPositionSeconds < 0 ||
    value.lastPositionSeconds > value.durationSeconds ||
    !isIsoDate(value.lastStudiedAt) ||
    !isStrictCaptionSource(
      value.captionSource,
      value.youtubeVideoId,
      value.durationSeconds,
    ) ||
    !Array.isArray(value.learningSentences) ||
    value.learningSentences.length === 0
  ) {
    return false;
  }
  const captionSource = value.captionSource as CaptionSource;
  const cueIds = new Set(captionSource.cues.map((cue) => cue.id as string));
  if (
    !value.learningSentences.every((sentence) =>
      isStrictLearningSentence(
        sentence,
        captionSource.id,
        cueIds,
        value.durationSeconds as number,
        false,
      ),
    ) ||
    !hasUniqueStrings(
      value.learningSentences.map(
        (sentence) => (sentence as LearningSentence).id as string,
      ),
    )
  ) {
    return false;
  }
  if (value.localRevision === undefined) return true;
  if (
    !isRecord(value.localRevision) ||
    !hasExactKeys(value.localRevision, ["sentences"]) ||
    !Array.isArray(value.localRevision.sentences) ||
    value.localRevision.sentences.length === 0
  ) {
    return false;
  }
  const originalIds = new Set(
    value.learningSentences.map(
      (sentence) => (sentence as LearningSentence).id as string,
    ),
  );
  return (
    value.localRevision.sentences.every(
      (sentence) =>
        isStrictLearningSentence(
          sentence,
          captionSource.id,
          cueIds,
          value.durationSeconds as number,
          true,
        ) &&
        (sentence as LocalRevisionSentence).originalSentenceIds.every((id) =>
          originalIds.has(id),
        ),
    ) &&
    hasUniqueStrings(
      value.localRevision.sentences.map(
        (sentence) => (sentence as LocalRevisionSentence).id as string,
      ),
    )
  );
}

function isStrictWordBankEntry(value: unknown): value is WordBankEntry {
  if (!isWordBankEntry(value) || !isRecord(value)) return false;
  if (
    !hasExactKeys(
      value,
      ["schemaVersion", "id", "savedAt", "expression", "origin", "lookup"],
    ) ||
    !isIsoDate(value.savedAt) ||
    !isRecord(value.expression) ||
    !hasExactKeys(value.expression, ["surfaceForm", "normalizedForm"]) ||
    !isRecord(value.origin) ||
    !hasExactKeys(value.origin, [
      "studyVideoId",
      "studyVideoTitle",
      "studyVideoChannel",
      "studyVideoThumbnailUrl",
      "learningSentenceId",
      "sentenceText",
      "startSeconds",
      "endSeconds",
    ]) ||
    !isRemoteUrl(value.origin.studyVideoThumbnailUrl) ||
    !isRecord(value.lookup) ||
    !hasExactKeys(
      value.lookup,
      ["dictionary", "selectedSenseId"],
      ["enrichment", "translation"],
    ) ||
    !isStrictDictionaryLookupResult(value.lookup.dictionary)
  ) {
    return false;
  }
  return (
    (value.lookup.enrichment === undefined ||
      isWordLookupAiResponse(value.lookup.enrichment)) &&
    (value.lookup.translation === undefined ||
      isWordLookupAiResponse(value.lookup.translation))
  );
}

function isStrictBackupWordLookup(value: unknown): value is BackupWordLookup {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["key", "value"]) ||
    typeof value.key !== "string" ||
    !isRecord(value.value) ||
    value.value.cacheKey !== value.key ||
    !isIsoDate(value.value.cachedAt)
  ) {
    return false;
  }
  if (value.value.explanationVersion === WORD_LOOKUP_EXPLANATION_VERSION) {
    return (
      hasExactKeys(value.value, [
        "cacheKey",
        "explanationVersion",
        "cachedAt",
        "result",
      ]) &&
      isCachedWordLookup(value.value) &&
      isStrictDictionaryLookupResult(value.value.result)
    );
  }
  if (value.value.explanationVersion === LOCAL_AI_WORD_LOOKUP_VERSION) {
    return (
      hasExactKeys(value.value, [
        "cacheKey",
        "explanationVersion",
        "cachedAt",
        "response",
      ]) && isCachedWordLookupAi(value.value)
    );
  }
  return false;
}

function isLocalLearningBackup(value: unknown): value is LocalLearningBackup {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "application",
      "backupSchemaVersion",
      "exportedAt",
      "data",
    ]) ||
    value.application !== "learn-my-english" ||
    value.backupSchemaVersion !== LOCAL_LEARNING_BACKUP_SCHEMA_VERSION ||
    !isIsoDate(value.exportedAt) ||
    !isRecord(value.data) ||
    !hasExactKeys(value.data, [
      "preferences",
      "studyLibrary",
      "wordLookups",
      "wordBank",
      "difficultSentences",
    ]) ||
    !isLearnerPreferences(value.data.preferences) ||
    !Array.isArray(value.data.studyLibrary) ||
    !value.data.studyLibrary.every(isStrictStudyVideo) ||
    !Array.isArray(value.data.wordLookups) ||
    !value.data.wordLookups.every(isStrictBackupWordLookup) ||
    !Array.isArray(value.data.wordBank) ||
    !value.data.wordBank.every(isStrictWordBankEntry) ||
    !Array.isArray(value.data.difficultSentences) ||
    !value.data.difficultSentences.every(isDifficultSentence)
  ) {
    return false;
  }
  return (
    hasUniqueStrings(
      value.data.studyLibrary.map(
        (studyVideo) => (studyVideo as StudyVideo).id as string,
      ),
    ) &&
    hasUniqueStrings(
      value.data.wordLookups.map(
        (lookup) => (lookup as BackupWordLookup).key,
      ),
    ) &&
    hasUniqueStrings(
      value.data.wordBank.map(
        (entry) => (entry as WordBankEntry).id,
      ),
    ) &&
    hasUniqueStrings(
      value.data.difficultSentences.map(
        (entry) => (entry as DifficultSentence).id,
      ),
    )
  );
}

function migrateLegacyBackup(value: unknown): LocalLearningBackup | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "application",
      "backupSchemaVersion",
      "exportedAt",
      "data",
    ]) ||
    value.application !== "learn-my-english" ||
    value.backupSchemaVersion !== 1 ||
    !isIsoDate(value.exportedAt) ||
    !isRecord(value.data) ||
    !hasExactKeys(value.data, [
      "preferences",
      "studyLibrary",
      "wordLookups",
      "wordBank",
    ]) ||
    !isLearnerPreferences(value.data.preferences) ||
    !Array.isArray(value.data.studyLibrary) ||
    !value.data.studyLibrary.every(isStrictStudyVideo) ||
    !Array.isArray(value.data.wordLookups) ||
    !value.data.wordLookups.every(isStrictBackupWordLookup) ||
    !Array.isArray(value.data.wordBank) ||
    !value.data.wordBank.every(isStrictWordBankEntry)
  ) {
    return null;
  }
  const legacy = value as LegacyLocalLearningBackup;
  const migrated: LocalLearningBackup = {
    application: legacy.application,
    backupSchemaVersion: 2,
    exportedAt: legacy.exportedAt,
    data: { ...legacy.data, difficultSentences: [] },
  };
  return isLocalLearningBackup(migrated) ? migrated : null;
}

export function parseLocalLearningBackupText(
  text: string,
): LocalLearningBackupParseResult {
  if (new Blob([text]).size > LOCAL_LEARNING_BACKUP_MAXIMUM_BYTES) {
    return { status: "invalid", reason: "too-large" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { status: "invalid", reason: "invalid-json" };
  }
  if (isLocalLearningBackup(parsed)) {
    return { status: "valid", backup: parsed };
  }
  const migrated = migrateLegacyBackup(parsed);
  if (migrated) return { status: "valid", backup: migrated };
  if (
    isRecord(parsed) &&
    Object.hasOwn(parsed, "backupSchemaVersion") &&
    parsed.backupSchemaVersion !== 1 &&
    parsed.backupSchemaVersion !== LOCAL_LEARNING_BACKUP_SCHEMA_VERSION
  ) {
    return { status: "invalid", reason: "unsupported-schema" };
  }
  return { status: "invalid", reason: "invalid-data" };
}

async function readStore(
  transaction: IDBTransaction,
  storeName: string,
): Promise<Array<{ key: string; value: unknown }>> {
  const store = transaction.objectStore(storeName);
  const [keys, values] = await Promise.all([
    requestResult(store.getAllKeys()),
    requestResult(store.getAll()),
  ]);
  if (
    keys.length !== values.length ||
    !keys.every((key) => typeof key === "string")
  ) {
    throw new LocalLearningBackupValidationError("Unsupported IndexedDB keys");
  }
  return values.map((value, index) => ({
    key: keys[index] as string,
    value,
  }));
}

export async function exportLocalLearningBackup(): Promise<LocalLearningBackup> {
  const database = await openLearningDatabase();
  try {
    const transaction = database.transaction(Object.values(LEARNING_STORES), "readonly");
    const [storedPreferences, storedStudyVideos, storedWordLookups, storedWordBank, storedDifficultSentences] =
      await Promise.all([
        readStore(transaction, LEARNING_STORES.preferences),
        readStore(transaction, LEARNING_STORES.studyVideos),
        readStore(transaction, LEARNING_STORES.wordLookups),
        readStore(transaction, LEARNING_STORES.wordBank),
        readStore(transaction, LEARNING_STORES.difficultSentences),
      ]);
    if (
      storedPreferences.length > 1 ||
      (storedPreferences[0] !== undefined &&
        (storedPreferences[0].key !== LEARNER_PREFERENCE_KEY ||
          !isLearnerPreferences(storedPreferences[0].value))) ||
      !storedStudyVideos.every(
        ({ key, value }) => isStrictStudyVideo(value) && value.id === key,
      ) ||
      !storedWordLookups.every(({ key, value }) =>
        isStrictBackupWordLookup({ key, value }),
      ) ||
      !storedWordBank.every(
        ({ key, value }) => isStrictWordBankEntry(value) && value.id === key,
      ) ||
      !storedDifficultSentences.every(
        ({ key, value }) => isDifficultSentence(value) && value.id === key,
      )
    ) {
      throw new LocalLearningBackupValidationError();
    }

    const backup: LocalLearningBackup = {
      application: "learn-my-english",
      backupSchemaVersion: LOCAL_LEARNING_BACKUP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        preferences:
          (storedPreferences[0]?.value as LearnerPreferences | undefined) ??
          DEFAULT_LEARNER_PREFERENCES,
        studyLibrary: storedStudyVideos.map(
          ({ value }) => value as StudyVideo,
        ),
        wordLookups: storedWordLookups.map(({ key, value }) => ({
          key,
          value: value as CachedWordLookup | CachedWordLookupAi,
        })),
        wordBank: storedWordBank.map(({ value }) => value as WordBankEntry),
        difficultSentences: storedDifficultSentences.map(
          ({ value }) => value as DifficultSentence,
        ),
      },
    };
    if (!isLocalLearningBackup(backup)) {
      throw new LocalLearningBackupValidationError();
    }
    return backup;
  } finally {
    database.close();
  }
}

type RestoreRecord = {
  key: string;
  storeName: string;
  value: unknown;
};

function restoreRecords(backup: LocalLearningBackup): RestoreRecord[] {
  return [
    {
      storeName: LEARNING_STORES.preferences,
      key: LEARNER_PREFERENCE_KEY,
      value: backup.data.preferences,
    },
    ...backup.data.studyLibrary.map((studyVideo) => ({
      storeName: LEARNING_STORES.studyVideos,
      key: studyVideo.id,
      value: studyVideo,
    })),
    ...backup.data.wordLookups.map(({ key, value }) => ({
      storeName: LEARNING_STORES.wordLookups,
      key,
      value,
    })),
    ...backup.data.wordBank.map((entry) => ({
      storeName: LEARNING_STORES.wordBank,
      key: entry.id,
      value: entry,
    })),
    ...backup.data.difficultSentences.map((entry) => ({
      storeName: LEARNING_STORES.difficultSentences,
      key: entry.id,
      value: entry,
    })),
  ];
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function restoreLocalLearningBackup(
  backup: LocalLearningBackup,
  mode: LocalLearningRestoreMode,
): Promise<void> {
  if (!isLocalLearningBackup(backup)) {
    throw new LocalLearningBackupValidationError();
  }
  const database = await openLearningDatabase();
  try {
    const transaction = database.transaction(
      Object.values(LEARNING_STORES),
      "readwrite",
    );
    const completed = transactionCompleted(transaction);
    const records = restoreRecords(backup);

    if (mode === "merge") {
      const existingValues = await Promise.all(
        records.map((record) =>
          requestResult(
            transaction.objectStore(record.storeName).get(record.key),
          ),
        ),
      );
      const hasConflict = existingValues.some(
        (existing, index) =>
          existing !== undefined &&
          canonicalJson(existing) !== canonicalJson(records[index]?.value),
      );
      if (hasConflict) {
        transaction.abort();
        try {
          await completed;
        } catch {
          // The deliberate abort guarantees that no merge writes can commit.
        }
        throw new LocalLearningBackupConflictError();
      }
      records.forEach((record, index) => {
        if (existingValues[index] === undefined) {
          transaction
            .objectStore(record.storeName)
            .put(record.value, record.key);
        }
      });
    } else {
      for (const storeName of Object.values(LEARNING_STORES)) {
        transaction.objectStore(storeName).clear();
      }
      for (const record of records) {
        transaction.objectStore(record.storeName).put(record.value, record.key);
      }
    }

    await completed;
  } catch (cause) {
    if (
      cause instanceof LocalLearningBackupConflictError ||
      cause instanceof LocalLearningBackupValidationError
    ) {
      throw cause;
    }
    throw new LocalPersistenceUnavailableError(
      "Unable to atomically restore local learning data",
    );
  } finally {
    database.close();
  }
}
