import { buildPublicationDraft } from "./curation";
import type { PublicationDraftInput } from "./domain";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "bilingual-curation-workflow" });
    }

    if (request.method === "POST" && url.pathname === "/api/preview") {
      try {
        const input = (await request.json()) as PublicationDraftInput;
        return json(buildPublicationDraft(input));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return json({ ok: false, error: message }, 400);
      }
    }

    return json({ ok: false, error: "Not found" }, 404);
  },
};
