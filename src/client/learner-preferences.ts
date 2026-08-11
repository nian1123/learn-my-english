import {
  LEARNING_STORES,
  LocalPersistenceUnavailableError,
  openLearningDatabase,
  requestResult,
  transactionCompleted,
} from "./learning-database";

const LEARNER_PREFERENCE_KEY = "learner-preferences";

export type LearnerPreferences = {
  hideTranscriptByDefault: boolean;
  deepSeekCloudConsent: DeepSeekCloudConsent;
};

export type DeepSeekCloudConsent = "unknown" | "granted" | "declined";

export const DEFAULT_LEARNER_PREFERENCES: LearnerPreferences = {
  hideTranscriptByDefault: false,
  deepSeekCloudConsent: "unknown",
};

function normalizePreferences(value: unknown): LearnerPreferences {
  if (typeof value !== "object" || value === null) {
    return DEFAULT_LEARNER_PREFERENCES;
  }
  const candidate = value as Record<string, unknown>;
  const deepSeekCloudConsent = candidate.deepSeekCloudConsent;
  return {
    hideTranscriptByDefault:
      typeof candidate.hideTranscriptByDefault === "boolean"
        ? candidate.hideTranscriptByDefault
        : DEFAULT_LEARNER_PREFERENCES.hideTranscriptByDefault,
    deepSeekCloudConsent:
      deepSeekCloudConsent === "granted" || deepSeekCloudConsent === "declined"
        ? deepSeekCloudConsent
        : "unknown",
  };
}

export async function readLearnerPreferences(): Promise<LearnerPreferences> {
  const database = await openLearningDatabase();

  try {
    const transaction = database.transaction(
      LEARNING_STORES.preferences,
      "readonly",
    );
    const stored = await requestResult(
      transaction
        .objectStore(LEARNING_STORES.preferences)
        .get(LEARNER_PREFERENCE_KEY),
    );

    return normalizePreferences(stored);
  } finally {
    database.close();
  }
}
export async function writeLearnerPreferences(
  preferences: LearnerPreferences,
): Promise<void> {
  const database = await openLearningDatabase();

  try {
    const transaction = database.transaction(
      LEARNING_STORES.preferences,
      "readwrite",
    );
    transaction
      .objectStore(LEARNING_STORES.preferences)
      .put(preferences, LEARNER_PREFERENCE_KEY);
    await transactionCompleted(transaction);
  } catch {
    throw new LocalPersistenceUnavailableError("Unable to save preferences");
  } finally {
    database.close();
  }
}
