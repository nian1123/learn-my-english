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

      <StudyLibraryList />
      <WordBankList />

      <footer>
        <span>Local-first learning workspace</span>
        <span>视频来自 YouTube · 学习记录留在当前浏览器</span>
      </footer>
    </main>
  );
}
