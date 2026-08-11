"use client";

import {
  createWordLookupRequest,
  tokenizeLookupText,
  type WordLookupRequest,
} from "@/domain/word-lookup";
import type { LearningSentenceId } from "@/domain/study-video";

type LearningSentenceTextProps = {
  onLookup: (request: WordLookupRequest) => void;
  onSelectionError: (message: string) => void;
  sentenceId: LearningSentenceId;
  text: string;
};

export function LearningSentenceText({
  onLookup,
  onSelectionError,
  sentenceId,
  text,
}: LearningSentenceTextProps) {
  const parts = tokenizeLookupText(text);

  const lookupSelection = (element: HTMLElement) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    if (
      !selection.anchorNode ||
      !selection.focusNode ||
      !element.contains(selection.anchorNode) ||
      !element.contains(selection.focusNode)
    ) {
      selection.removeAllRanges();
      onSelectionError(
        "只能查询同一句 Learning Sentence 中的连续文本",
      );
      return;
    }

    const surfaceForm = selection.toString().replace(/\s+/g, " ").trim();
    selection.removeAllRanges();
    if (!surfaceForm) return;
    try {
      onLookup(createWordLookupRequest(sentenceId, text, surfaceForm));
    } catch (error) {
      onSelectionError(
        error instanceof Error ? error.message : "请选择英文单词或连续短语",
      );
    }
  };

  return (
    <strong
      className="learning-sentence-text"
      onMouseUp={(event) => lookupSelection(event.currentTarget)}
    >
      {parts.map((part) =>
        part.kind === "separator" ? (
          part.text
        ) : (
          <button
            aria-label={`查询 ${part.text}`}
            className="lookup-token"
            key={`${part.start}:${part.text}`}
            onClick={() =>
              onLookup(
                createWordLookupRequest(
                  sentenceId,
                  text,
                  part.text,
                  part.start,
                ),
              )
            }
            type="button"
          >
            {part.text}
          </button>
        ),
      )}
    </strong>
  );
}
