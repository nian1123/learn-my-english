"use client";

import { useState, type FormEvent } from "react";

import {
  sentenceSplitPositions,
  type EffectiveLearningSentence,
  type LocalRevisionCommand,
} from "@/domain/local-revision";

type LearningSentenceEditorProps = {
  canMergeNext: boolean;
  canMergePrevious: boolean;
  index: number;
  onApply: (command: LocalRevisionCommand) => Promise<void>;
  onCancel: () => void;
  sentence: EffectiveLearningSentence;
};

function numericValue(value: string) {
  return value.trim() ? Number(value) : Number.NaN;
}

export function LearningSentenceEditor({
  canMergeNext,
  canMergePrevious,
  index,
  onApply,
  onCancel,
  sentence,
}: LearningSentenceEditorProps) {
  const [text, setText] = useState(sentence.text);
  const [startSeconds, setStartSeconds] = useState(
    String(sentence.startSeconds),
  );
  const [endSeconds, setEndSeconds] = useState(String(sentence.endSeconds));
  const [splitPosition, setSplitPosition] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const splitPositions = sentenceSplitPositions(text);

  const apply = async (command: LocalRevisionCommand) => {
    setError(null);
    setPending(true);
    try {
      await onApply(command);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "修订未能保存，请稍后重试",
      );
      setPending(false);
    }
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void apply({
      type: "edit",
      sentenceId: sentence.id,
      text,
      startSeconds: numericValue(startSeconds),
      endSeconds: numericValue(endSeconds),
    });
  };

  return (
    <form
      aria-label={`编辑第 ${index + 1} 句`}
      className="sentence-editor"
      onSubmit={save}
      role="region"
    >
      <div className="sentence-editor-heading">
        <div>
          <span>LOCAL REVISION</span>
          <h3>编辑第 {index + 1} 句</h3>
        </div>
        <button disabled={pending} onClick={onCancel} type="button">
          取消
        </button>
      </div>

      <label className="sentence-editor-text">
        <span>句子文本</span>
        <textarea
          disabled={pending}
          onChange={(event) => setText(event.target.value)}
          rows={3}
          value={text}
        />
      </label>
      <div className="sentence-editor-times">
        <label>
          <span>开始时间（秒）</span>
          <input
            disabled={pending}
            min="0"
            onChange={(event) => setStartSeconds(event.target.value)}
            step="0.001"
            type="number"
            value={startSeconds}
          />
        </label>
        <label>
          <span>结束时间（秒）</span>
          <input
            disabled={pending}
            min="0"
            onChange={(event) => setEndSeconds(event.target.value)}
            step="0.001"
            type="number"
            value={endSeconds}
          />
        </label>
      </div>

      <div className="sentence-editor-split">
        <label>
          <span>拆分位置</span>
          <select
            disabled={pending || splitPositions.length === 0}
            onChange={(event) => setSplitPosition(event.target.value)}
            value={splitPosition}
          >
            <option value="">选择单词边界</option>
            {splitPositions.map((position) => (
              <option key={position} value={position}>
                在“{text.slice(0, position).trim().split(/\s+/).at(-1)}”后
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={pending || !splitPosition}
          onClick={() =>
            void apply({
              type: "split",
              sentenceId: sentence.id,
              splitPosition: Number(splitPosition),
            })
          }
          type="button"
        >
          拆分句子
        </button>
      </div>

      {error ? (
        <p className="sentence-editor-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="sentence-editor-actions">
        <div>
          <button
            disabled={pending || !canMergePrevious}
            onClick={() =>
              void apply({
                type: "merge",
                sentenceId: sentence.id,
                direction: "previous",
              })
            }
            type="button"
          >
            与上一句合并
          </button>
          <button
            disabled={pending || !canMergeNext}
            onClick={() =>
              void apply({
                type: "merge",
                sentenceId: sentence.id,
                direction: "next",
              })
            }
            type="button"
          >
            与下一句合并
          </button>
        </div>
        <div>
          {sentence.revised ? (
            <button
              className="restore-sentence-button"
              disabled={pending}
              onClick={() => {
                if (
                  window.confirm(
                    "恢复这一句会放弃与它相关的 Local Revision，是否继续？",
                  )
                ) {
                  void apply({
                    type: "restore-sentence",
                    sentenceId: sentence.id,
                  });
                }
              }}
              type="button"
            >
              恢复这一句
            </button>
          ) : null}
          <button
            className="save-revision-button"
            disabled={pending}
            type="submit"
          >
            {pending ? "保存中…" : "保存修订"}
          </button>
        </div>
      </div>
    </form>
  );
}
