import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import {
  ConnectivityAlert,
  StudyLibraryClientProvider,
} from "./study-library-client-context";
import "./globals.css";
import { DifficultSentenceCompletionNotice } from "./difficult-sentence-completion-notice";

export const metadata: Metadata = {
  title: "Learn My English",
  description: "用真实访谈逐句练习美式英语听力",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0a0f1b",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <StudyLibraryClientProvider>
          <ConnectivityAlert />
          {children}
          <DifficultSentenceCompletionNotice />
        </StudyLibraryClientProvider>
      </body>
    </html>
  );
}
