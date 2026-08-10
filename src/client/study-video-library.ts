import {
  LEARNING_STORES,
  LocalPersistenceUnavailableError,
  openLearningDatabase,
  requestResult,
  transactionCompleted,
} from "./learning-database";
import type { StudyVideo, StudyVideoId } from "@/domain/study-video";

function isStudyVideo(value: unknown): value is StudyVideo {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<StudyVideo>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.id === "string" &&
    typeof candidate.youtubeVideoId === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.lastStudiedAt === "string" &&
    Array.isArray(candidate.learningSentences)
  );
}

export async function saveStudyVideo(studyVideo: StudyVideo): Promise<void> {
  const database = await openLearningDatabase();

  try {
    const transaction = database.transaction(
      LEARNING_STORES.studyVideos,
      "readwrite",
    );
    transaction.objectStore(LEARNING_STORES.studyVideos).put(studyVideo, studyVideo.id);
    await transactionCompleted(transaction);
  } catch {
    throw new LocalPersistenceUnavailableError("Unable to save Study Video");
  } finally {
    database.close();
  }
}

export async function readStudyVideo(id: StudyVideoId): Promise<StudyVideo | null> {
  const database = await openLearningDatabase();

  try {
    const transaction = database.transaction(
      LEARNING_STORES.studyVideos,
      "readonly",
    );
    const stored = await requestResult(
      transaction.objectStore(LEARNING_STORES.studyVideos).get(id),
    );
    return isStudyVideo(stored) ? stored : null;
  } finally {
    database.close();
  }
}

export async function readStudyLibrary(): Promise<StudyVideo[]> {
  const database = await openLearningDatabase();

  try {
    const transaction = database.transaction(
      LEARNING_STORES.studyVideos,
      "readonly",
    );
    const stored = await requestResult(
      transaction.objectStore(LEARNING_STORES.studyVideos).getAll(),
    );

    return stored
      .filter(isStudyVideo)
      .sort((left, right) =>
        right.lastStudiedAt.localeCompare(left.lastStudiedAt),
      );
  } finally {
    database.close();
  }
}

export async function updateStudyPosition(
  id: StudyVideoId,
  positionSeconds: number,
): Promise<void> {
  const studyVideo = await readStudyVideo(id);
  if (!studyVideo) return;

  await saveStudyVideo({
    ...studyVideo,
    lastPositionSeconds: positionSeconds,
    lastStudiedAt: new Date().toISOString(),
  });
}
