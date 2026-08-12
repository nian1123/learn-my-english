import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  RuntimeDiagnostic,
  RuntimeDiagnosticsResponse,
} from "@/domain/runtime-diagnostics";

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 3_000;

function configuredProvider(
  capability: "supadata" | "local-ai" | "deepseek",
  variables: readonly (string | undefined)[],
): RuntimeDiagnostic {
  const isConfigured = variables.every((value) => Boolean(value?.trim()));

  return {
    capability,
    status: isConfigured ? "configured" : "not-configured",
  };
}

async function inspectYtDlp(): Promise<RuntimeDiagnostic> {
  const executable = process.env.YT_DLP_PATH?.trim() || "yt-dlp";

  try {
    const { stdout } = await execFileAsync(executable, ["--version"], {
      timeout: PROBE_TIMEOUT_MS,
    });

    return {
      capability: "yt-dlp",
      status: "available",
      detail: stdout.trim() || "可用",
    };
  } catch {
    return { capability: "yt-dlp", status: "unavailable" };
  }
}

async function inspectDictionary(): Promise<RuntimeDiagnostic> {
  const baseUrl =
    process.env.DICTIONARY_API_BASE_URL?.trim() ||
    "https://api.dictionaryapi.dev";

  try {
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/api/v2/entries/en/hello`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      },
    );

    return {
      capability: "dictionary",
      status: response.ok ? "available" : "unavailable",
    };
  } catch {
    return { capability: "dictionary", status: "unavailable" };
  }
}

export async function inspectRuntime(): Promise<RuntimeDiagnosticsResponse> {
  const diagnostics = await Promise.all([
    Promise.resolve(
      configuredProvider("supadata", [process.env.SUPADATA_API_KEY]),
    ),
    inspectYtDlp(),
    Promise.resolve(
      configuredProvider("local-ai", [
        process.env.OPENAI_BASE_URL,
        process.env.OPENAI_API_KEY,
        process.env.OPENAI_MODEL,
      ]),
    ),
    Promise.resolve(
      configuredProvider("deepseek", [
        process.env.DEEPSEEK_BASE_URL,
        process.env.DEEPSEEK_API_KEY,
        process.env.DEEPSEEK_MODEL,
      ]),
    ),
    inspectDictionary(),
  ]);

  return {
    diagnostics,
    checkedAt: new Date().toISOString(),
  };
}
