export const LEARNING_DATABASE_NAME = "learn-my-english";
export const LEARNING_DATABASE_VERSION = 4;

export const LEARNING_STORES = {
  preferences: "preferences",
  studyVideos: "study-videos",
  wordLookups: "word-lookups",
  wordBank: "word-bank",
} as const;

export class LocalPersistenceUnavailableError extends Error {
  constructor(message = "IndexedDB is not available") {
    super(message);
    this.name = "LocalPersistenceUnavailableError";
  }
}

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function transactionCompleted(
  transaction: IDBTransaction,
): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function openLearningDatabase(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || typeof window.indexedDB === "undefined") {
    throw new LocalPersistenceUnavailableError();
  }

  const request = window.indexedDB.open(
    LEARNING_DATABASE_NAME,
    LEARNING_DATABASE_VERSION,
  );

  request.onupgradeneeded = () => {
    for (const storeName of Object.values(LEARNING_STORES)) {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName);
      }
    }
  };

  try {
    return await requestResult(request);
  } catch {
    throw new LocalPersistenceUnavailableError("Unable to open IndexedDB");
  }
}
