import { isWordBankEntry, type WordBankEntry } from "@/domain/word-bank";

import {
  LEARNING_STORES,
  LocalPersistenceUnavailableError,
  openLearningDatabase,
  requestResult,
  transactionCompleted,
} from "./learning-database";

export async function readWordBankEntry(id: string): Promise<WordBankEntry | null> {
  const database = await openLearningDatabase();
  try {
    const transaction = database.transaction(LEARNING_STORES.wordBank, "readonly");
    const stored = await requestResult(
      transaction.objectStore(LEARNING_STORES.wordBank).get(id),
    );
    return isWordBankEntry(stored) ? stored : null;
  } finally {
    database.close();
  }
}

export async function readWordBank(): Promise<WordBankEntry[]> {
  const database = await openLearningDatabase();
  try {
    const transaction = database.transaction(LEARNING_STORES.wordBank, "readonly");
    const stored = await requestResult(
      transaction.objectStore(LEARNING_STORES.wordBank).getAll(),
    );
    return stored
      .filter(isWordBankEntry)
      .sort((left, right) => right.savedAt.localeCompare(left.savedAt));
  } finally {
    database.close();
  }
}

export async function saveWordBankEntry(entry: WordBankEntry): Promise<void> {
  const database = await openLearningDatabase();
  try {
    const transaction = database.transaction(LEARNING_STORES.wordBank, "readwrite");
    transaction.objectStore(LEARNING_STORES.wordBank).put(entry, entry.id);
    await transactionCompleted(transaction);
  } catch {
    throw new LocalPersistenceUnavailableError("Unable to save Word Bank entry");
  } finally {
    database.close();
  }
}

export async function removeWordBankEntry(id: string): Promise<void> {
  const database = await openLearningDatabase();
  try {
    const transaction = database.transaction(LEARNING_STORES.wordBank, "readwrite");
    transaction.objectStore(LEARNING_STORES.wordBank).delete(id);
    await transactionCompleted(transaction);
  } catch {
    throw new LocalPersistenceUnavailableError("Unable to remove Word Bank entry");
  } finally {
    database.close();
  }
}
