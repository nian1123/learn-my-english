import { createServer } from "node:http";

const host = "127.0.0.1";
const port = 4178;
let completedJobPolls = 0;

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);

  if (requestUrl.pathname === "/health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }

  if (
    requestUrl.pathname.startsWith("/v1/transcript") &&
    (request.method !== "GET" ||
      request.headers["x-api-key"] !== "e2e-supadata-secret")
  ) {
    json(response, 400, { error: "invalid-test-authorization" });
    return;
  }

  if (requestUrl.pathname === "/v1/transcript/job-complete") {
    completedJobPolls += 1;
    if (completedJobPolls === 1) {
      json(response, 200, { status: "queued" });
      return;
    }
    json(response, 200, {
      availableLangs: ["en"],
      content: [
        {
          duration: 2_500,
          lang: "en",
          offset: 1_000,
          text: "The asynchronous transcript completed.",
        },
      ],
      lang: "en",
      status: "completed",
    });
    return;
  }

  if (requestUrl.pathname === "/v1/transcript/job-failed") {
    json(response, 200, {
      error: { message: "deterministic job failure" },
      status: "failed",
    });
    return;
  }

  if (requestUrl.pathname === "/v1/transcript/job-wait") {
    json(response, 200, { status: "active" });
    return;
  }

  if (requestUrl.pathname === "/v1/transcript/job-invalid") {
    json(response, 200, { status: "unexpected" });
    return;
  }

  if (requestUrl.pathname !== "/v1/transcript") {
    json(response, 404, { error: "not-found" });
    return;
  }

  const videoUrl = requestUrl.searchParams.get("url") ?? "";
  const queryKeys = [...requestUrl.searchParams.keys()].sort();
  const hasRequiredContract =
    request.method === "GET" &&
    request.headers["x-api-key"] === "e2e-supadata-secret" &&
    requestUrl.searchParams.get("lang") === "en" &&
    requestUrl.searchParams.get("text") === "false" &&
    requestUrl.searchParams.get("mode") === "native" &&
    requestUrl.searchParams.getAll("mode").length === 1 &&
    JSON.stringify(queryKeys) ===
      JSON.stringify(["lang", "mode", "text", "url"]) &&
    /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(
      videoUrl,
    );

  if (!hasRequiredContract) {
    json(response, 400, { error: "invalid-test-contract" });
    return;
  }

  if (videoUrl.endsWith("supadata001")) {
    json(response, 200, {
      availableLangs: ["en"],
      content: [
        {
          duration: 2_500,
          lang: "en",
          offset: 1_000,
          text: "Supadata native captions stay synchronized.",
        },
        {
          duration: 3_000,
          lang: "en",
          offset: 4_000,
          text: "The second sentence follows.",
        },
      ],
      lang: "en",
    });
    return;
  }

  if (videoUrl.endsWith("dQw4w9WgXcQ")) {
    json(response, 200, {
      availableLangs: ["en"],
      content: [
        {
          duration: 2_500,
          lang: "en",
          offset: 1_000,
          text: "Welcome to the show.",
        },
        {
          duration: 3_000,
          lang: "en",
          offset: 4_000,
          text: "Today we're talking about practice.",
        },
      ],
      lang: "en",
    });
    return;
  }

  if (videoUrl.endsWith("supanonen01")) {
    json(response, 200, {
      availableLangs: ["zh"],
      content: [
        {
          duration: 2_500,
          lang: "zh",
          offset: 1_000,
          text: "这不是英文字幕。",
        },
      ],
      lang: "zh",
    });
    return;
  }

  if (videoUrl.endsWith("supaauth001")) {
    json(response, 401, { error: "unauthorized" });
    return;
  }

  if (videoUrl.endsWith("supabad0001")) {
    json(response, 200, {
      availableLangs: ["en"],
      content: [
        {
          duration: -1,
          lang: "en",
          offset: 1_000,
          text: "Invalid timing must not be persisted.",
        },
      ],
      lang: "en",
    });
    return;
  }

  if (videoUrl.endsWith("supaover001")) {
    json(response, 200, {
      availableLangs: ["en"],
      content: [
        {
          duration: 2_000,
          lang: "en",
          offset: 73_000,
          text: "This caption ends beyond the video duration.",
        },
      ],
      lang: "en",
    });
    return;
  }

  if (videoUrl.endsWith("supafail001")) {
    json(response, 500, { error: "internal-error" });
    return;
  }

  if (videoUrl.endsWith("supajson001")) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{");
    return;
  }

  if (videoUrl.endsWith("supanet0001")) {
    request.socket.destroy();
    return;
  }

  if (videoUrl.endsWith("supalarge01")) {
    response.writeHead(200, {
      "content-length": String(10 * 1024 * 1024 + 1),
      "content-type": "application/json",
    });
    response.end("{}");
    return;
  }

  if (videoUrl.endsWith("supachunk01")) {
    response.writeHead(200, { "content-type": "application/json" });
    const chunk = "x".repeat(1024 * 1024);
    for (let index = 0; index < 11; index += 1) response.write(chunk);
    response.end();
    return;
  }

  if (videoUrl.endsWith("supaquota01")) {
    json(response, 429, { error: "limit-exceeded" });
    return;
  }

  if (videoUrl.endsWith("supaslow001")) {
    setTimeout(
      () => json(response, 500, { error: "late-provider-failure" }),
      2_000,
    );
    return;
  }

  if (videoUrl.endsWith("supajob0001")) {
    json(response, 202, { jobId: "job-complete" });
    return;
  }

  if (videoUrl.endsWith("supajobfail")) {
    json(response, 202, { jobId: "job-failed" });
    return;
  }

  if (videoUrl.endsWith("supajobwait")) {
    json(response, 202, { jobId: "job-wait" });
    return;
  }

  if (videoUrl.endsWith("supajobbad0")) {
    json(response, 202, { jobId: "job-invalid" });
    return;
  }

  json(response, 206, {
    error: "transcript-unavailable",
    message: "Transcript unavailable",
  });
});

server.listen(port, host);

const close = () => server.close(() => process.exit(0));
process.on("SIGINT", close);
process.on("SIGTERM", close);
