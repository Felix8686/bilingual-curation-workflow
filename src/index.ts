import { curateWithAi, type AiEnv } from "./ai";
import { buildPublicationDraft } from "./curation";
import type {
  AiCurationRequest,
  PublicationDraftInput,
  SourceSearchRequest,
} from "./domain";
import { searchSources } from "./sources";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: AiEnv): Promise<Response> {
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

    if (request.method === "POST" && url.pathname === "/api/sources/search") {
      try {
        const input = (await request.json()) as SourceSearchRequest;
        return json(await searchSources(input));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return json({ ok: false, error: message }, 400);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/ai/curate") {
      try {
        const input = (await request.json()) as AiCurationRequest;
        return json(await curateWithAi(input, env));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        const status = /must be configured/i.test(message) ? 503 : 400;
        return json({ ok: false, error: message }, status);
      }
    }

    return json({ ok: false, error: "Not found" }, 404);
  },
};
