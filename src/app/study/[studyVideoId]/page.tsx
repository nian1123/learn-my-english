import { StudySession } from "../../study-session";
import { isStudyVideoId } from "@/domain/study-video";

export default async function StudyVideoPage({
  params,
  searchParams,
}: {
  params: Promise<{ studyVideoId: string }>;
  searchParams: Promise<{
    play?: string | string[];
    sentenceId?: string | string[];
  }>;
}) {
  const { studyVideoId } = await params;
  const query = await searchParams;
  if (!isStudyVideoId(studyVideoId)) {
    return (
      <main className="study-loading">
        <h1>找不到这个 Study Video</h1>
        <p>这个学习链接无效。</p>
      </main>
    );
  }

  return (
    <StudySession
      autoplayTarget={query.play === "1"}
      studyVideoId={studyVideoId}
      targetSentenceId={
        typeof query.sentenceId === "string" ? query.sentenceId : undefined
      }
    />
  );
}
