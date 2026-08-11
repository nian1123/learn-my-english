import { createServer } from "node:http";

const host = "127.0.0.1";
const port = 4177;
const requests = [];

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function untrustedData(body) {
  const content = body?.messages?.find((message) => message.role === "user")
    ?.content;
  if (typeof content !== "string") return {};
  const prefix = "UNTRUSTED_LOOKUP_DATA=";
  if (!content.startsWith(prefix)) return {};
  try {
    return JSON.parse(content.slice(prefix.length));
  } catch {
    return {};
  }
}

function completion(content) {
  return {
    id: "chatcmpl-e2e-deepseek",
    object: "chat.completion",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content: JSON.stringify(content) },
      },
    ],
  };
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);

  if (requestUrl.pathname === "/health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }

  if (requestUrl.pathname === "/reset" && request.method === "POST") {
    requests.splice(0);
    response.writeHead(204);
    response.end();
    return;
  }

  if (requestUrl.pathname === "/requests") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ items: requests }));
    return;
  }

  if (requestUrl.pathname !== "/v1/chat/completions" || request.method !== "POST") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
    return;
  }

  let body;
  try {
    body = await readBody(request);
  } catch {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "invalid json" }));
    return;
  }

  const data = untrustedData(body);
  requests.push({
    authorization: request.headers.authorization ?? null,
    body,
    expression: data.expression ?? null,
    task: data.task ?? null,
  });

  if (data.expression === "talk about") {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "deepseek unavailable" }));
    return;
  }

  if (data.expression === "talk about practice") {
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          completion({
            senseId: "0:0:0",
            auxiliaryExample: "This response should arrive too late.",
          }),
        ),
      );
    }, 800);
    return;
  }

  if (data.expression === "talk" && data.task === "translate") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(completion({ chineseMeaning: 42 })));
    return;
  }

  const result =
    data.task === "translate"
      ? { chineseMeaning: "谈话；交谈" }
      : {
          senseId: "0:0:0",
          auxiliaryExample:
            "They talk every morning before the interview begins.",
        };
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(completion(result)));
});

server.listen(port, host);

const close = () => server.close(() => process.exit(0));
process.on("SIGINT", close);
process.on("SIGTERM", close);
