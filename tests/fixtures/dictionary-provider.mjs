import { createServer } from "node:http";

const host = "127.0.0.1";
const port = 4174;

const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }

  if (request.url === "/api/v2/entries/en/hello") {
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

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not found" }));
});

server.listen(port, host);

const close = () => server.close(() => process.exit(0));
process.on("SIGINT", close);
process.on("SIGTERM", close);
