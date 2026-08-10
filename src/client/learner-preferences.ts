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
};

export const DEFAULT_LEARNER_PREFERENCES: LearnerPreferences = {
  hideTranscriptByDefault: false,
};

function validPreferences(value: unknown): value is LearnerPreferences {
  return (
    typeof value === "object" &&
    value !== null &&
    "hideTranscriptByDefault" in value &&
    typeof value.hideTranscriptByDefault === "boolean"
  );
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

    return validPreferences(stored)
      ? stored
      : DEFAULT_LEARNER_PREFERENCES;
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
