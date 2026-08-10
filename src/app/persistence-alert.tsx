"use client";

import { useStudyLibraryClient } from "./study-library-client-context";

export function PersistenceAlert() {
  const { persistenceStatus } = useStudyLibraryClient();

  if (persistenceStatus !== "unavailable") return null;

  return (
    <div className="blocking-alert" role="alert">
      <strong>本地数据不可用，暂时不能保存学习内容</strong>
      <span>请检查 Chrome 的网站数据权限，然后刷新页面重试。</span>
    </div>
  );
}
