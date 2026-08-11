export const LOCAL_LEARNING_DATA_CHANGED_EVENT =
  "learn-my-english:local-learning-data-changed";

export function announceLocalLearningDataChanged() {
  window.dispatchEvent(new Event(LOCAL_LEARNING_DATA_CHANGED_EVENT));
}
