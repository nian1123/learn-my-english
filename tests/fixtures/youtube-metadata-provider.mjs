import { createServer } from "node:http";

const host = "127.0.0.1";
const port = 4175;

const server = createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);

  if (requestUrl.pathname === "/health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }

  if (requestUrl.pathname === "/oembed") {
    const videoUrl = requestUrl.searchParams.get("url") ?? "";
    const knownVideo =
      videoUrl.includes("dQw4w9WgXcQ") ||
      videoUrl.includes("autocaps001") ||
      videoUrl.includes("failure0001") ||
      videoUrl.includes("nocaptions1") ||
      videoUrl.includes("slowcap0001") ||
      videoUrl.includes("timeout0001") ||
      videoUrl.includes("supadata001") ||
      videoUrl.includes("supanonen01") ||
      videoUrl.includes("supaauth001") ||
      videoUrl.includes("supabad0001") ||
      videoUrl.includes("supaover001") ||
      videoUrl.includes("supafail001") ||
      videoUrl.includes("supajson001") ||
      videoUrl.includes("supanet0001") ||
      videoUrl.includes("supalarge01") ||
      videoUrl.includes("supachunk01") ||
      videoUrl.includes("supaquota01") ||
      videoUrl.includes("supaslow001") ||
      videoUrl.includes("supajob0001") ||
      videoUrl.includes("supajobfail") ||
      videoUrl.includes("supajobwait") ||
      videoUrl.includes("supajobbad0") ||
      videoUrl.includes("slowvideo01");

    if (!knownVideo) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "video not found" }));
      return;
    }

    const sendMetadata = () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          title: "The Daily American Interview",
          author_name: "Everyday Voices",
          thumbnail_url:
            "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        }),
      );
    };

    if (videoUrl.includes("slowvideo01")) {
      setTimeout(sendMetadata, 1_500);
    } else {
      sendMetadata();
    }
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not found" }));
});

server.listen(port, host);

const close = () => server.close(() => process.exit(0));
process.on("SIGINT", close);
process.on("SIGTERM", close);
