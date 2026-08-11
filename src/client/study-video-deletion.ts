import { isWordBankEntry } from "@/domain/word-bank";
import type { StudyVideoId } from "@/domain/study-video";

import {
  LEARNING_STORES,
  LocalPersistenceUnavailableError,
  openLearningDatabase,
  requestResult,
  transactionCompleted,
} from "./learning-database";

export type StudyVideoDeletionPolicy =
  | "retain-word-bank-contexts"
  | "remove-word-bank-contexts";

export type StudyVideoDeletionResult = {
  removedWordBankEntryCount: number;
};

export async function deleteStudyVideoLearningData(
  studyVideoId: StudyVideoId,
  policy: StudyVideoDeletionPolicy,
): Promise<StudyVideoDeletionResult> {
  const database = await openLearningDatabase();

  try {
    const transaction = database.transaction(
      [LEARNING_STORES.studyVideos, LEARNING_STORES.wordBank],
      "readwrite",
    );
    const studyVideos = transaction.objectStore(LEARNING_STORES.studyVideos);
    const wordBank = transaction.objectStore(LEARNING_STORES.wordBank);
    let removedWordBankEntryCount = 0;

    if (policy === "remove-word-bank-contexts") {
      const storedEntries = await requestResult(wordBank.getAll());
      for (const storedEntry of storedEntries) {
        if (
          isWordBankEntry(storedEntry) &&
          storedEntry.origin.studyVideoId === studyVideoId
        ) {
          wordBank.delete(storedEntry.id);
          removedWordBankEntryCount += 1;
        }
      }
    }

    studyVideos.delete(studyVideoId);
    await transactionCompleted(transaction);
    return { removedWordBankEntryCount };
  } catch {
    throw new LocalPersistenceUnavailableError(
      "Unable to atomically delete Study Video learning data",
    );
  } finally {
    database.close();
  }
}
