import { inspectRuntime } from "@/server/runtime-diagnostics";

export const runtime = "nodejs";

export async function GET() {
  const diagnostics = await inspectRuntime();
  return Response.json(diagnostics, {
    headers: { "Cache-Control": "no-store" },
  });
}
