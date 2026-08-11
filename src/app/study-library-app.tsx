import { ImportEntry } from "./import-entry";
import { PersistenceAlert } from "./persistence-alert";
import { SettingsAndDiagnostics } from "./settings-and-diagnostics";
import { StudyLibraryList } from "./study-library-list";
import { WordBankList } from "./word-bank-list";

function LibraryMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="brand-mark">
      <rect x="9" y="8" width="30" height="32" rx="6" />
      <path d="M9 17h30M9 31h30M17 8v32M31 8v32" />
      <path className="brand-mark-play" d="m22 20 8 4-8 4v-8Z" />
    </svg>
  );
}

export function StudyLibraryApp() {
  return (
    <main className="app-shell" id="main-content">
      <header className="topbar">
        <a className="brand" href="#main-content" aria-label="Learn My English 首页">
          <LibraryMark />
          <span>
            <strong>Learn My English</strong>
            <small>Contextual Listening Archive</small>
          </span>
        </a>
        <div className="topbar-actions">
          <span className="local-first-status">
            <i aria-hidden="true" />
            数据保存在本机
          </span>
          <SettingsAndDiagnostics />
        </div>
      </header>

      <PersistenceAlert />

      <section className="hero" aria-labelledby="library-page-title">
        <div className="hero-copy">
          <p className="eyebrow">STUDY LIBRARY · AMERICAN ENGLISH</p>
          <h1 id="library-page-title">我的学习库</h1>
          <p className="hero-lede">
            收藏值得反复听的真实访谈。每次回来，都从上次那一句继续。
          </p>
        </div>

        <ImportEntry />
      </section>

      <StudyLibraryList />
      <WordBankList />

      <footer>
        <span>Local-first learning workspace</span>
        <span>视频来自 YouTube · 学习记录留在当前浏览器</span>
      </footer>
    </main>
  );
}
