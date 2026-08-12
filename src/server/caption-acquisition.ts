export type AcquiredCaptionSource = {
  contents: string;
  fileName: string;
  format: "srt" | "vtt";
  kind: "platform-provided";
  provider: "supadata" | "yt-dlp";
};
