import { DifficultSentenceDetail } from "../../difficult-sentence-detail";
import { isDifficultSentenceId } from "@/domain/difficult-sentence";

export default async function DifficultSentencePage({
  params,
  searchParams,
}: {
  params: Promise<{ difficultSentenceId: string }>;
  searchParams: Promise<{
    generate?: string | string[];
    query?: string | string[];
    status?: string | string[];
  }>;
}) {
  const { difficultSentenceId } = await params;
  const query = await searchParams;
  if (!isDifficultSentenceId(difficultSentenceId)) {
    return (
      <main className="difficult-sentence-page" id="main-content">
        <h1>找不到这个 Difficult Sentence</h1>
      </main>
    );
  }
  return (
    <DifficultSentenceDetail
      difficultSentenceId={difficultSentenceId}
      initialFilter={
        typeof query.status === "string" &&
        ["all", "pending", "learning", "mastered"].includes(query.status)
          ? query.status as "all" | "pending" | "learning" | "mastered"
          : "all"
      }
      initialQuery={typeof query.query === "string" ? query.query : ""}
      startGeneration={query.generate === "1"}
    />
  );
}
