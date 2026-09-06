import { curateWithAi, type AiEnv } from "./ai";
import {
  createBatch,
  D1BatchStore,
  type D1DatabaseLike,
  runBatch,
} from "./batch";
import { buildPublicationDraft } from "./curation";
import type {
  AiCurationRequest,
  BatchCreateRequest,
  BatchEnqueueRequest,
  BatchQueueMessage,
  BatchRunRequest,
  EndToEndWorkflowRequest,
  PublicationDraftInput,
  SourceSearchRequest,
} from "./domain";
import {
  consumeBatchQueue,
  enqueueBatch,
  type QueueMessageBatchLike,
  type QueueProducerLike,
} from "./queue";
import { searchSources } from "./sources";
import { runEndToEndWorkflow } from "./workflow";

interface AppEnv extends AiEnv {
  DB?: D1DatabaseLike;
  BATCH_QUEUE?: QueueProducerLike;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function errorStatus(message: string): number {
  if (/must be configured|D1 DB binding|Queue binding/i.test(message)) return 503;
  if (/Batch not found/i.test(message)) return 404;
  if (/no candidates|selected no candidates/i.test(message)) return 422;
  return 400;
}

function requireBatchStore(env: AppEnv): D1BatchStore {
  if (!env.DB) throw new Error("D1 DB binding must be configured.");
  return new D1BatchStore(env.DB);
}

function requireBatchQueue(env: AppEnv): QueueProducerLike {
  if (!env.BATCH_QUEUE) throw new Error("Queue binding must be configured.");
  return env.BATCH_QUEUE;
}

async function readJsonOrEmpty<T extends object>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}

export default {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
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
        return json({ ok: false, error: message }, errorStatus(message));
      }
    }

    if (request.method === "POST" && url.pathname === "/api/workflows/generate") {
      try {
        const input = (await request.json()) as EndToEndWorkflowRequest;
        return json(await runEndToEndWorkflow(input, env));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return json({ ok: false, error: message }, errorStatus(message));
      }
    }

    if (request.method === "POST" && url.pathname === "/api/batches") {
      try {
        const input = (await request.json()) as BatchCreateRequest;
        return json(await createBatch(input, requireBatchStore(env)), 201);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return json({ ok: false, error: message }, errorStatus(message));
      }
    }

    const batchMatch = url.pathname.match(/^\/api\/batches\/([^/]+)$/);
    if (request.method === "GET" && batchMatch) {
      try {
        const batch = await requireBatchStore(env).get(decodeURIComponent(batchMatch[1]));
        if (!batch) return json({ ok: false, error: "Batch not found." }, 404);
        return json(batch);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return json({ ok: false, error: message }, errorStatus(message));
      }
    }

    const runMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/run$/);
    if (request.method === "POST" && runMatch) {
      try {
        const input = await readJsonOrEmpty<BatchRunRequest>(request);
        return json(
          await runBatch(
            decodeURIComponent(runMatch[1]),
            input,
            env,
            requireBatchStore(env),
          ),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return json({ ok: false, error: message }, errorStatus(message));
      }
    }

    const enqueueMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/enqueue$/);
    if (request.method === "POST" && enqueueMatch) {
      try {
        const input = await readJsonOrEmpty<BatchEnqueueRequest>(request);
        return json(
          await enqueueBatch(
            decodeURIComponent(enqueueMatch[1]),
            input,
            requireBatchStore(env),
            requireBatchQueue(env),
          ),
          202,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return json({ ok: false, error: message }, errorStatus(message));
      }
    }

    return json({ ok: false, error: "Not found" }, 404);
  },

  async queue(batch: QueueMessageBatchLike<BatchQueueMessage>, env: AppEnv): Promise<void> {
    await consumeBatchQueue(batch, env, requireBatchStore(env));
  },
};
