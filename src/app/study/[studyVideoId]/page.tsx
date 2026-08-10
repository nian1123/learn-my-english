import { StudySession } from "../../study-session";

export default async function StudyVideoPage({
  params,
}: {
  params: Promise<{ studyVideoId: string }>;
}) {
  const { studyVideoId } = await params;
  return <StudySession studyVideoId={studyVideoId} />;
}
