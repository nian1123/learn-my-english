"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { readStudyLibrary } from "@/client/study-video-library";
import type { StudyVideo } from "@/domain/study-video";
import { formatMediaTime } from "@/domain/time";

function EmptyLibraryIllustration() {
  return (
    <svg aria-hidden="true" viewBox="0 0 240 180" className="empty-art">
      <rect x="32" y="30" width="176" height="112" rx="18" />
      <path d="m102 68 52 30-52 30V68Z" />
      <path d="M70 156h100" />
      <circle cx="186" cy="47" r="20" />
      <path d="M178 47h16M186 39v16" />
    </svg>
  );
}

export function StudyLibraryList() {
  const [studyVideos, setStudyVideos] = useState<StudyVideo[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;

    readStudyLibrary()
      .then((storedStudyVideos) => {
        if (active) setStudyVideos(storedStudyVideos);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });

    return () => {
      active = false;
    };
  }, []);

  const count = studyVideos?.length ?? 0;

  return (
    <section className="library-section" aria-labelledby="library-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">STUDY LIBRARY</p>
          <h2 id="library-title">最近学习</h2>
        </div>
        <span className="count-pill">{count} 个视频</span>
      </div>

      {loadFailed ? (
        <div className="library-load-error" role="alert">
          无法读取本地学习库，请检查 Chrome 的网站数据权限。
        </div>
      ) : null}

      {studyVideos?.length === 0 ? (
        <div className="empty-state">
          <EmptyLibraryIllustration />
          <div>
            <p className="empty-kicker">YOUR FIRST INTERVIEW</p>
            <h3>还没有学习视频</h3>
            <p>
              准备好后，把一段可公开播放的 YouTube 访谈和 Caption Source
              加入这里。
            </p>
          </div>
        </div>
      ) : null}

      {studyVideos && studyVideos.length > 0 ? (
        <div className="study-video-grid">
          {studyVideos.map((studyVideo) => (
            <article className="study-video-card" key={studyVideo.id}>
              <img
                alt={`${studyVideo.title} 缩略图`}
                src={studyVideo.thumbnailUrl}
              />
              <div className="study-video-card-copy">
                <p>{studyVideo.channel}</p>
                <h3>{studyVideo.title}</h3>
                <div className="study-video-meta">
                  <span>{formatMediaTime(studyVideo.durationSeconds)}</span>
                  <span>
                    上次位置 {formatMediaTime(studyVideo.lastPositionSeconds)}
                  </span>
                </div>
                <Link href={`/study/${encodeURIComponent(studyVideo.id)}`}>
                  继续学习
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
