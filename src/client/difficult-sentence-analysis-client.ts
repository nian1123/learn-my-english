import {
  parseDifficultSentenceAnalysisResponse,
  type DifficultSentenceAnalysisRequest,
  type DifficultSentenceAnalysisResponse,
} from "@/domain/difficult-sentence-ai";
import type { DifficultSentence } from "@/domain/difficult-sentence";
import { completeDifficultSentenceAnalysis } from "./difficult-sentence-library";

export async function requestDifficultSentenceAnalysis(
  analysis: DifficultSentenceAnalysisRequest,
  allowDeepSeekFallback: boolean,
  signal?: AbortSignal,
): Promise<DifficultSentenceAnalysisResponse> {
  try {
    const response = await fetch("/api/difficult-sentence-analysis", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analysis, allowDeepSeekFallback }),
      signal,
    });
    const payload: unknown = await response.json();
    const parsed = parseDifficultSentenceAnalysisResponse(
      payload,
      analysis.sentence,
    );
    if (response.ok && parsed) return parsed;
  } catch {
    // The durable Pending analysis remains available for a later retry.
  }
  return { status: "unavailable", reason: "provider-failure" };
}

const activeGenerations = new Map<
  string,
  Promise<DifficultSentenceAnalysisResponse>
>();

export function generateDifficultSentenceAnalysis(
  difficultSentence: DifficultSentence,
  allowDeepSeekFallback: boolean,
) {
  const active = activeGenerations.get(difficultSentence.id);
  if (active) return active;
  const request: DifficultSentenceAnalysisRequest = {
    task: "difficult-sentence-analysis",
    sentence: difficultSentence.snapshot.text,
    ...(difficultSentence.snapshot.previousSentenceText
      ? { previousSentence: difficultSentence.snapshot.previousSentenceText }
      : {}),
    ...(difficultSentence.snapshot.nextSentenceText
      ? { nextSentence: difficultSentence.snapshot.nextSentenceText }
      : {}),
    interval: {
      startSeconds: difficultSentence.snapshot.startSeconds,
      endSeconds: difficultSentence.snapshot.endSeconds,
    },
  };
  const generation = requestDifficultSentenceAnalysis(
    request,
    allowDeepSeekFallback,
    undefined,
  )
    .then(async (response) => {
      if (response.status === "available") {
        await completeDifficultSentenceAnalysis({
          analysis: response.result,
          id: difficultSentence.id,
          provenance: "ai",
        });
        window.dispatchEvent(
          new CustomEvent("learn-my-english:difficult-sentence-analysis-complete", {
            detail: { difficultSentenceId: difficultSentence.id },
          }),
        );
      }
      return response;
    })
    .finally(() => activeGenerations.delete(difficultSentence.id));
  activeGenerations.set(difficultSentence.id, generation);
  return generation;
}
