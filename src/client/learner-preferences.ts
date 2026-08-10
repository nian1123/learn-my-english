const DATABASE_NAME = "learn-my-english";
const DATABASE_VERSION = 1;
const PREFERENCE_STORE = "preferences";
const LEARNER_PREFERENCE_KEY = "learner-preferences";

export type LearnerPreferences = {
  hideTranscriptByDefault: boolean;
};

export const DEFAULT_LEARNER_PREFERENCES: LearnerPreferences = {
  hideTranscriptByDefault: false,
};

export class LocalPersistenceUnavailableError extends Error {
  constructor(message = "IndexedDB is not available") {
    super(message);
    this.name = "LocalPersistenceUnavailableError";
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionCompleted(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function openPreferenceDatabase(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || typeof window.indexedDB === "undefined") {
    throw new LocalPersistenceUnavailableError();
  }

  const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(PREFERENCE_STORE)) {
      request.result.createObjectStore(PREFERENCE_STORE);
    }
  };

  try {
    return await requestResult(request);
  } catch {
    throw new LocalPersistenceUnavailableError("Unable to open IndexedDB");
  }
}

function validPreferences(value: unknown): value is LearnerPreferences {
  return (
    typeof value === "object" &&
    value !== null &&
    "hideTranscriptByDefault" in value &&
    typeof value.hideTranscriptByDefault === "boolean"
  );
}

export async function readLearnerPreferences(): Promise<LearnerPreferences> {
  const database = await openPreferenceDatabase();

  try {
    const transaction = database.transaction(PREFERENCE_STORE, "readonly");
    const stored = await requestResult(
      transaction.objectStore(PREFERENCE_STORE).get(LEARNER_PREFERENCE_KEY),
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
  const database = await openPreferenceDatabase();

  try {
    const transaction = database.transaction(PREFERENCE_STORE, "readwrite");
    transaction
      .objectStore(PREFERENCE_STORE)
      .put(preferences, LEARNER_PREFERENCE_KEY);
    await transactionCompleted(transaction);
  } catch {
    throw new LocalPersistenceUnavailableError("Unable to save preferences");
  } finally {
    database.close();
  }
}
