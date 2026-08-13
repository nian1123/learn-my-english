import { createServer } from "node:http";

const host = "127.0.0.1";
const port = 4176;
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
  const prefixes = [
    "UNTRUSTED_LOOKUP_DATA=",
    "UNTRUSTED_DIFFICULT_SENTENCE_DATA=",
  ];
  const prefix = prefixes.find((candidate) => content.startsWith(candidate));
  if (!prefix) return {};
  try {
    return JSON.parse(content.slice(prefix.length));
  } catch {
    return {};
  }
}

function completion(content) {
  return {
    id: "chatcmpl-e2e-local",
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

  if (data.task === "difficult-sentence-analysis") {
    const sentence = data.sentence ?? "";
    if (sentence.includes("needs cloud fallback")) {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "local provider unavailable" }));
      return;
    }
    const importantText = "talking about practice";
    const importantStart = sentence.indexOf(importantText);
    const weakText = "we're";
    const weakStart = sentence.indexOf(weakText);
    const sendAnalysis = () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          completion({
            naturalMeaning: "今天我们在讨论练习这件事。",
            listeningSkeleton: "we 是主语，are talking 是核心动作，about practice 补充讨论主题。",
            captureOrder: ["先抓 talking", "再确认主题 practice"],
            importantItems: importantStart >= 0 ? [{
              text: importantText,
              occurrence: 1,
              contextualMeaning: "讨论练习",
              informationContribution: "承载本句的核心动作和主题",
              listeningPriority: "先抓动作 talking，再补主题 practice",
            }] : [],
            weakForms: weakStart >= 0 ? [{
              text: weakText,
              occurrence: 1,
              reducedForm: "/wɪr/",
              listeningCue: "功能成分可能快速连读，请回原视频核对",
            }, {
              text: "to",
              occurrence: 1,
              reducedForm: "/tə/",
              listeningCue: "非重读时可能弱化，请回原视频核对",
            }].filter((item) => sentence.includes(item.text)) : [],
          }),
        ),
      );
    };
    if (sentence.includes("slow local Difficult Sentence")) {
      setTimeout(sendAnalysis, 15_200);
      return;
    }
    sendAnalysis();
    return;
  }

  if (data.expression === "talk about") {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "local provider unavailable" }));
    return;
  }

  if (data.expression === "talk about practice") {
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          completion({
            senseId: "0:0:0",
            auxiliaryExample:
              "The class will talk about practice before the next exercise.",
          }),
        ),
      );
    }, 800);
    return;
  }

  if (data.expression === "talk") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify(
        completion({ senseId: 99, auxiliaryExample: "" }),
      ),
    );
    return;
  }

  if (data.expression === "cold-start") {
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          completion({
            senseId: "0:0:0",
            auxiliaryExample:
              "A brief warm-up helps the local model answer reliably.",
          }),
        ),
      );
    }, 5_200);
    return;
  }

  const result =
    data.task === "translate"
      ? { chineseMeaning: "练习；实践" }
      : {
          senseId: "0:0:0",
          auxiliaryExample:
            "She improves her pronunciation through daily practice.",
        };
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(completion(result)));
});

server.listen(port, host);

const close = () => server.close(() => process.exit(0));
process.on("SIGINT", close);
process.on("SIGTERM", close);
