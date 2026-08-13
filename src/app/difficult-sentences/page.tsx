import { DifficultSentenceLibrary, type DifficultSentenceFilter } from "../difficult-sentence-library";

export default async function DifficultSentenceLibraryPage({ searchParams }: {
  searchParams: Promise<{ query?: string | string[]; status?: string | string[] }>;
}) {
  const query = await searchParams;
  const status = typeof query.status === "string" && ["all", "pending", "learning", "mastered"].includes(query.status)
    ? query.status as DifficultSentenceFilter
    : "all";
  return <DifficultSentenceLibrary initialFilter={status} initialQuery={typeof query.query === "string" ? query.query : ""} />;
}
