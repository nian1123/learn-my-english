import { createServer } from "node:http";

const host = "127.0.0.1";
const port = 4174;
const requestCounts = new Map();

const entries = {
  practice: [
    {
      word: "practice",
      phonetic: "/ˈpræk.tɪs/",
      phonetics: [
        {
          text: "/ˈpræk.tɪs/",
          audio:
            "https://api.dictionaryapi.dev/media/pronunciations/en/practice-us.mp3",
          sourceUrl: "https://commons.wikimedia.org/wiki/File:En-us-practice.ogg",
          license: {
            name: "BY-SA 3.0",
            url: "https://creativecommons.org/licenses/by-sa/3.0",
          },
        },
      ],
      meanings: [
        {
          partOfSpeech: "noun",
          definitions: [
            {
              definition: "Repetition of an activity to improve a skill.",
              example: "Careful listening improves with practice.",
            },
          ],
        },
      ],
      sourceUrls: ["https://en.wiktionary.org/wiki/practice"],
    },
  ],
  talk: [
    {
      word: "talk",
      phonetic: "/tɔːk/",
      phonetics: [{ text: "/tɔːk/", audio: "" }],
      meanings: [
        {
          partOfSpeech: "verb",
          definitions: [
            {
              definition: "To communicate, usually by means of speech.",
              example: "We talk about language every day.",
            },
          ],
        },
      ],
    },
  ],
  "talk about": [
    {
      word: "talk about",
      meanings: [
        {
          partOfSpeech: "phrase",
          definitions: [
            {
              definition: "To discuss a particular subject.",
              example: "Today we talk about practice.",
            },
          ],
        },
      ],
    },
  ],
  "talk about practice": [
    {
      word: "talk about practice",
      meanings: [
        {
          partOfSpeech: "phrase",
          definitions: [
            {
              definition: "To discuss the repeated work used to improve a skill.",
            },
          ],
        },
      ],
    },
  ],
};

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);

  if (requestUrl.pathname === "/health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }

  if (requestUrl.pathname === "/reset" && request.method === "POST") {
    requestCounts.clear();
    response.writeHead(204);
    response.end();
    return;
  }

  if (requestUrl.pathname === "/requests") {
    const term = requestUrl.searchParams.get("term") ?? "";
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ count: requestCounts.get(term) ?? 0 }));
    return;
  }

  if (requestUrl.pathname === "/api/v2/entries/en/hello") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify([
        {
          word: "hello",
          meanings: [
            {
              partOfSpeech: "exclamation",
              definitions: [{ definition: "Used as a greeting." }],
            },
          ],
        },
      ]),
    );
    return;
  }

  const prefix = "/api/v2/entries/en/";
  if (requestUrl.pathname.startsWith(prefix)) {
    const term = decodeURIComponent(requestUrl.pathname.slice(prefix.length));
    requestCounts.set(term, (requestCounts.get(term) ?? 0) + 1);

    if (term === "failure") {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "provider unavailable" }));
      return;
    }

    const result = entries[term];
    if (result) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(result));
      return;
    }
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not found" }));
});

server.listen(port, host);

const close = () => server.close(() => process.exit(0));
process.on("SIGINT", close);
process.on("SIGTERM", close);
