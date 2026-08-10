export function formatMediaTime(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  return hours > 0
    ? [hours, minutes, seconds]
        .map((part, index) =>
          index === 0 ? String(part) : String(part).padStart(2, "0"),
        )
        .join(":")
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}
