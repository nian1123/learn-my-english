import { ImportEntry } from "./import-entry";
import { PersistenceAlert } from "./persistence-alert";
import { SettingsAndDiagnostics } from "./settings-and-diagnostics";

function LibraryMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="brand-mark">
      <path d="M12 9.5h16a8 8 0 0 1 8 8v21H20a8 8 0 0 0-8-8v-21Z" />
      <path d="M18 16h12M18 22h12" />
    </svg>
  );
}

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

export function StudyLibraryApp() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Learn My English 首页">
          <LibraryMark />
          <span>
            <strong>Learn My English</strong>
            <small>逐句听懂真实访谈</small>
          </span>
        </a>
        <SettingsAndDiagnostics />
      </header>

      <PersistenceAlert />

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">AMERICAN ENGLISH · LISTEN SENTENCE BY SENTENCE</p>
          <h1>我的学习库</h1>
          <p className="hero-lede">
            从你真正想看的访谈开始，把自然语速拆成一句一句，听清楚，再开口。
          </p>
        </div>

        <ImportEntry />
      </section>

      <section className="library-section" aria-labelledby="library-empty-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">STUDY LIBRARY</p>
            <h2>最近学习</h2>
          </div>
          <span className="count-pill">0 个视频</span>
        </div>

        <div className="empty-state">
          <EmptyLibraryIllustration />
          <div>
            <p className="empty-kicker">YOUR FIRST INTERVIEW</p>
            <h3 id="library-empty-title">还没有学习视频</h3>
            <p>
              准备好后，把一段有英文字幕、可公开播放的 YouTube
              访谈加入这里。
            </p>
          </div>
        </div>
      </section>

      <footer>
        <span>本地优先 · 学习数据留在这台浏览器</span>
        <span>环境诊断已就绪</span>
      </footer>
    </main>
  );
}
