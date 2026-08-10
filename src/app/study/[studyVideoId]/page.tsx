import { StudySession } from "../../study-session";
import { isStudyVideoId } from "@/domain/study-video";

export default async function StudyVideoPage({
  params,
}: {
  params: Promise<{ studyVideoId: string }>;
}) {
  const { studyVideoId } = await params;
  if (!isStudyVideoId(studyVideoId)) {
    return (
      <main className="study-loading">
        <h1>找不到这个 Study Video</h1>
        <p>这个学习链接无效。</p>
      </main>
    );
  }

  return <StudySession studyVideoId={studyVideoId} />;
}
