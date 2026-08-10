import { StudyLibraryApp } from "./study-library-app";
import { StudyLibraryClientProvider } from "./study-library-client";

export default function HomePage() {
  return (
    <StudyLibraryClientProvider>
      <StudyLibraryApp />
    </StudyLibraryClientProvider>
  );
}
