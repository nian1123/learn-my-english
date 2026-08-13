"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function DifficultSentenceCompletionNotice() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const handleComplete = (event: Event) => {
      const custom = event as CustomEvent<{ difficultSentenceId?: unknown }>;
      if (typeof custom.detail?.difficultSentenceId === "string") {
        setId(custom.detail.difficultSentenceId);
      }
    };
    window.addEventListener(
      "learn-my-english:difficult-sentence-analysis-complete",
      handleComplete,
    );
    return () =>
      window.removeEventListener(
        "learn-my-english:difficult-sentence-analysis-complete",
        handleComplete,
      );
  }, []);
  if (!id) return null;
  return (
    <div className="difficult-analysis-notice" role="status">
      <span>Difficult Sentence 解析已完成</span>
      <Link href={`/difficult-sentences/${encodeURIComponent(id)}`}>查看</Link>
      <button aria-label="关闭解析完成提示" onClick={() => setId(null)} type="button">×</button>
    </div>
  );
}
