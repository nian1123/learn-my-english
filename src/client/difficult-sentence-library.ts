import {
  createPendingDifficultSentence,
  difficultSentenceHasSameSnapshot,
  difficultSentenceIdFromUuid,
  isDifficultSentence,
  type DifficultSentence,
  type DifficultSentenceAnalysis,
  type DifficultSentenceId,
  type DifficultSentenceLearningState,
  type DifficultSentenceProvenance,
  parseDifficultSentenceAnalysis,
} from "@/domain/difficult-sentence";
import type { LocalRevisionSentence, StudyVideo } from "@/domain/study-video";

import {
  LEARNING_STORES,
  LocalPersistenceUnavailableError,
  openLearningDatabase,
  requestResult,
  transactionCompleted,
} from "./learning-database";
import { announceLocalLearningDataChanged } from "./local-learning-data-events";

export async function collectDifficultSentence({
  nextSentence,
  previousSentence,
  sentence,
  studyVideo,
}: {
  nextSentence?: LocalRevisionSentence;
  previousSentence?: LocalRevisionSentence;
  sentence: LocalRevisionSentence;
  studyVideo: StudyVideo;
}): Promise<{ difficultSentence: DifficultSentence; created: boolean }> {
  const database = await openLearningDatabase();
  try {
    const transaction = database.transaction(
      LEARNING_STORES.difficultSentences,
      "readwrite",
    );
    const store = transaction.objectStore(LEARNING_STORES.difficultSentences);
    const existing = (await requestResult(store.getAll()))
      .filter(isDifficultSentence)
      .find((candidate) =>
        difficultSentenceHasSameSnapshot(candidate, studyVideo.id, sentence),
      );
    if (existing) {
      await transactionCompleted(transaction);
      return { difficultSentence: existing, created: false };
    }

    const difficultSentence = createPendingDifficultSentence({
      adjacentSentences: { next: nextSentence, previous: previousSentence },
      id: difficultSentenceIdFromUuid(crypto.randomUUID()),
      sentence,
      studyVideo,
    });
    store.put(difficultSentence, difficultSentence.id);
    await transactionCompleted(transaction);
    announceLocalLearningDataChanged();
    return { difficultSentence, created: true };
  } catch {
    throw new LocalPersistenceUnavailableError(
      "Unable to collect Difficult Sentence",
    );
  } finally {
    database.close();
  }
}

export async function readDifficultSentence(
  id: DifficultSentenceId,
): Promise<DifficultSentence | null> {
  const database = await openLearningDatabase();
  try {
    const transaction = database.transaction(
      LEARNING_STORES.difficultSentences,
      "readonly",
    );
    const stored = await requestResult(
      transaction.objectStore(LEARNING_STORES.difficultSentences).get(id),
    );
    return isDifficultSentence(stored) ? stored : null;
  } finally {
    database.close();
  }
}

export async function readDifficultSentenceLibrary(): Promise<
  DifficultSentence[]
> {
  const database = await openLearningDatabase();
  try {
    const transaction = database.transaction(
      LEARNING_STORES.difficultSentences,
      "readonly",
    );
    const stored = await requestResult(
      transaction.objectStore(LEARNING_STORES.difficultSentences).getAll(),
    );
    return stored
      .filter(isDifficultSentence)
      .sort((left, right) => right.collectedAt.localeCompare(left.collectedAt));
  } finally {
    database.close();
  }
}

export async function updateDifficultSentence(
  id: DifficultSentenceId,
  transform: (item: DifficultSentence) => DifficultSentence,
): Promise<DifficultSentence | null> {
  const database = await openLearningDatabase();
  let transformFailure: unknown;
  try {
    const transaction = database.transaction(
      LEARNING_STORES.difficultSentences,
      "readwrite",
    );
    const store = transaction.objectStore(LEARNING_STORES.difficultSentences);
    const stored = await requestResult(store.get(id));
    if (!isDifficultSentence(stored)) {
      await transactionCompleted(transaction);
      return null;
    }
    let updated: DifficultSentence;
    try {
      updated = transform(stored);
      if (!isDifficultSentence(updated)) {
        throw new Error("Invalid Difficult Sentence update");
      }
    } catch (error) {
      transformFailure = error;
      transaction.abort();
      throw error;
    }
    store.put(updated, id);
    await transactionCompleted(transaction);
    announceLocalLearningDataChanged();
    return updated;
  } catch {
    if (transformFailure) throw transformFailure;
    throw new LocalPersistenceUnavailableError(
      "Unable to update Difficult Sentence",
    );
  } finally {
    database.close();
  }
}

async function compareAndSetDifficultSentenceAnalysis({
  analysis,
  expected,
  id,
  mode,
}: {
  analysis: unknown;
  expected: DifficultSentence;
  id: DifficultSentenceId;
  mode: "initial" | "replacement";
}): Promise<{ applied: boolean; item: DifficultSentence | null }> {
  const database = await openLearningDatabase();
  try {
    const transaction = database.transaction(
      LEARNING_STORES.difficultSentences,
      "readwrite",
    );
    const store = transaction.objectStore(LEARNING_STORES.difficultSentences);
    const stored = await requestResult(store.get(id));
    if (!isDifficultSentence(stored)) {
      await transactionCompleted(transaction);
      return { applied: false, item: null };
    }
    const eligible =
      mode === "initial"
        ? !stored.analysis
        : Boolean(stored.analysis) &&
          Boolean(expected.analysis) &&
          stored.provenance === expected.provenance &&
          JSON.stringify(stored.analysis) === JSON.stringify(expected.analysis);
    if (!eligible) {
      await transactionCompleted(transaction);
      return { applied: false, item: stored };
    }
    const parsed = parseDifficultSentenceAnalysis(analysis, stored.snapshot.text);
    if (!parsed) {
      transaction.abort();
      throw new Error("难句解析内容不完整或引用范围无效");
    }
    const updated: DifficultSentence = {
      ...stored,
      generationStatus: "complete",
      analysis: parsed,
      provenance: "ai",
      learningState: stored.learningState ?? "learning",
      updatedAt: new Date().toISOString(),
    };
    store.put(updated, id);
    await transactionCompleted(transaction);
    announceLocalLearningDataChanged();
    return { applied: true, item: updated };
  } finally {
    database.close();
  }
}

export async function removeDifficultSentence(
  id: DifficultSentenceId,
): Promise<void> {
  const database = await openLearningDatabase();
  try {
    const transaction = database.transaction(
      LEARNING_STORES.difficultSentences,
      "readwrite",
    );
    transaction.objectStore(LEARNING_STORES.difficultSentences).delete(id);
    await transactionCompleted(transaction);
    announceLocalLearningDataChanged();
  } catch {
    throw new LocalPersistenceUnavailableError(
      "Unable to remove Difficult Sentence",
    );
  } finally {
    database.close();
  }
}

export async function completeDifficultSentenceAnalysis({
  analysis,
  id,
  provenance,
}: {
  analysis: unknown;
  id: DifficultSentenceId;
  provenance: DifficultSentenceProvenance;
}) {
  return updateDifficultSentence(id, (item) => {
    const parsed = parseDifficultSentenceAnalysis(analysis, item.snapshot.text);
    if (!parsed) throw new Error("难句解析内容不完整或引用范围无效");
    return {
      ...item,
      generationStatus: "complete",
      analysis: parsed,
      provenance,
      learningState: item.learningState ?? "learning",
      updatedAt: new Date().toISOString(),
    };
  });
}

export async function completePendingDifficultSentenceAnalysis({
  analysis,
  expected,
  id,
}: {
  analysis: unknown;
  expected: DifficultSentence;
  id: DifficultSentenceId;
}) {
  return compareAndSetDifficultSentenceAnalysis({
    analysis,
    expected,
    id,
    mode: "initial",
  });
}

export async function replaceDifficultSentenceAnalysis({
  analysis,
  expected,
  id,
}: {
  analysis: unknown;
  expected: DifficultSentence;
  id: DifficultSentenceId;
}) {
  return compareAndSetDifficultSentenceAnalysis({
    analysis,
    expected,
    id,
    mode: "replacement",
  });
}

export async function setDifficultSentenceLearningState(
  id: DifficultSentenceId,
  learningState: DifficultSentenceLearningState,
) {
  return updateDifficultSentence(id, (item) => {
    if (!item.analysis) throw new Error("Pending analysis has no learning state");
    return { ...item, learningState, updatedAt: new Date().toISOString() };
  });
}
