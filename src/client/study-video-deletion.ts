import { isWordBankEntry } from "@/domain/word-bank";
import { isDifficultSentence } from "@/domain/difficult-sentence";
import type { StudyVideoId } from "@/domain/study-video";

import {
  LEARNING_STORES,
  LocalPersistenceUnavailableError,
  openLearningDatabase,
  requestResult,
  transactionCompleted,
} from "./learning-database";

export type StudyVideoDeletionPolicy = {
  removeWordBankContexts: boolean;
  removeDifficultSentences: boolean;
};

export type StudyVideoDeletionResult = {
  removedWordBankEntryCount: number;
  removedDifficultSentenceCount: number;
};

export async function deleteStudyVideoLearningData(
  studyVideoId: StudyVideoId,
  policy: StudyVideoDeletionPolicy,
): Promise<StudyVideoDeletionResult> {
  const database = await openLearningDatabase();

  try {
    const transaction = database.transaction(
      [
        LEARNING_STORES.studyVideos,
        LEARNING_STORES.wordBank,
        LEARNING_STORES.difficultSentences,
      ],
      "readwrite",
    );
    const studyVideos = transaction.objectStore(LEARNING_STORES.studyVideos);
    const wordBank = transaction.objectStore(LEARNING_STORES.wordBank);
    const difficultSentences = transaction.objectStore(
      LEARNING_STORES.difficultSentences,
    );
    let removedWordBankEntryCount = 0;
    let removedDifficultSentenceCount = 0;

    if (policy.removeWordBankContexts) {
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

    if (policy.removeDifficultSentences) {
      const storedDifficultSentences = await requestResult(
        difficultSentences.getAll(),
      );
      for (const storedItem of storedDifficultSentences) {
        if (
          isDifficultSentence(storedItem) &&
          storedItem.origin.studyVideoId === studyVideoId
        ) {
          difficultSentences.delete(storedItem.id);
          removedDifficultSentenceCount += 1;
        }
      }
    }

    studyVideos.delete(studyVideoId);
    await transactionCompleted(transaction);
    return { removedWordBankEntryCount, removedDifficultSentenceCount };
  } catch {
    throw new LocalPersistenceUnavailableError(
      "Unable to atomically delete Study Video learning data",
    );
  } finally {
    database.close();
  }
}
