import process from "node:process";

const applicationBaseUrl = new URL(
  process.env.REAL_PROVIDER_BASE_URL || "http://127.0.0.1:3000",
);
const realYouTubeUrl = process.env.REAL_YOUTUBE_URL;

function youtubeVideoId(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") {
      const candidate = url.pathname.split("/").filter(Boolean)[0];
      return /^[\w-]{11}$/.test(candidate || "") ? candidate : null;
    }
    if (
      url.hostname === "youtube.com" ||
      url.hostname.endsWith(".youtube.com")
    ) {
      const candidate =
        url.pathname === "/watch"
          ? url.searchParams.get("v")
          : url.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})/)?.[1];
      return /^[\w-]{11}$/.test(candidate || "") ? candidate : null;
    }
  } catch {
    return null;
  }
  return null;
}

async function requestJson(path, options = {}, timeoutMs = 10_000) {
  const startedAt = performance.now();
  const response = await fetch(new URL(path, applicationBaseUrl), {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const elapsedMs = performance.now() - startedAt;
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  const text = await response.text();
  if (text.length > 11 * 1024 * 1024) {
    throw new Error(`${path} exceeded the 11 MB smoke-check limit`);
  }
  try {
    return { elapsedMs, payload: JSON.parse(text) };
  } catch {
    throw new Error(`${path} returned invalid JSON`);
  }
}

function record(value) {
  return typeof value === "object" && value !== null ? value : null;
}

function report(label, elapsedMs) {
  process.stdout.write(`PASS ${label} (${Math.round(elapsedMs)} ms)\n`);
}

async function main() {
  const videoId = youtubeVideoId(realYouTubeUrl);
  if (!videoId) {
    throw new Error(
      "Set REAL_YOUTUBE_URL to one public, embeddable YouTube video with English captions.",
    );
  }
  if (
    process.env.REAL_LOCAL_AI_CHECK === "1" &&
    process.env.REAL_DEEPSEEK_CHECK === "1"
  ) {
    throw new Error("Run Local AI and DeepSeek checks separately.");
  }

  const diagnostics = await requestJson("/api/diagnostics");
  if (!Array.isArray(record(diagnostics.payload)?.diagnostics)) {
    throw new Error("Runtime diagnostics returned an invalid response.");
  }
  report("runtime diagnostics", diagnostics.elapsedMs);

  const metadata = await requestJson(
    `/api/youtube/metadata?videoId=${encodeURIComponent(videoId)}`,
    {},
    7_000,
  );
  const metadataPayload = record(metadata.payload);
  if (
    metadataPayload?.videoId !== videoId ||
    typeof metadataPayload.title !== "string"
  ) {
    throw new Error("Real YouTube metadata response was incomplete.");
  }
  if (metadata.elapsedMs > 5_000) {
    throw new Error("Real YouTube metadata missed the 5-second target.");
  }
  report("real YouTube metadata", metadata.elapsedMs);

  const captions = await requestJson(
    "/api/youtube/captions",
    { method: "POST", body: JSON.stringify({ videoId }) },
    35_000,
  );
  const captionPayload = record(captions.payload);
  if (
    typeof captionPayload?.contents !== "string" ||
    !["vtt", "srt"].includes(captionPayload.format) ||
    !["manual", "auto-generated"].includes(captionPayload.kind)
  ) {
    throw new Error("Real caption provider returned an invalid Caption Source.");
  }
  if (captions.elapsedMs > 30_000) {
    throw new Error("Real caption acquisition missed the 30-second target.");
  }
  report("real English Caption Source", captions.elapsedMs);

  const dictionary = await requestJson(
    "/api/dictionary?term=practice",
    {},
    6_000,
  );
  if (!record(dictionary.payload) || dictionary.elapsedMs > 5_000) {
    throw new Error("Real dictionary lookup missed the 5-second target.");
  }
  report("real dictionary lookup", dictionary.elapsedMs);

  if (
    process.env.REAL_LOCAL_AI_CHECK === "1" ||
    process.env.REAL_DEEPSEEK_CHECK === "1"
  ) {
    const expectedMode =
      process.env.REAL_DEEPSEEK_CHECK === "1" ? "deepseek" : "local-ai";
    const ai = await requestJson(
      "/api/word-lookup/ai",
      {
        method: "POST",
        body: JSON.stringify({
          allowDeepSeekFallback: expectedMode === "deepseek",
          lookup: {
            task: "enrich",
            expression: "practice",
            sentence: "Careful listening improves with practice.",
            senses: [
              {
                id: "0:0:0",
                partOfSpeech: "noun",
                definition: "Repetition of an activity to improve a skill.",
              },
            ],
          },
        }),
      },
      8_000,
    );
    const aiPayload = record(ai.payload);
    if (aiPayload?.status !== "available" || aiPayload.mode !== expectedMode) {
      throw new Error(
        `The requested ${expectedMode} check did not use that provider. Check the running app configuration.`,
      );
    }
    report(`real ${expectedMode} lookup`, ai.elapsedMs);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown failure";
  process.stderr.write(`FAIL real-provider check: ${message}\n`);
  process.exitCode = 1;
});
