export type RuntimeCapability =
  | "yt-dlp"
  | "local-ai"
  | "deepseek"
  | "dictionary";

export type RuntimeStatus =
  | "available"
  | "configured"
  | "not-configured"
  | "unavailable";

export type RuntimeDiagnostic = {
  capability: RuntimeCapability;
  status: RuntimeStatus;
  detail?: string;
};

export type RuntimeDiagnosticsResponse = {
  diagnostics: RuntimeDiagnostic[];
  checkedAt: string;
};
