import type { AiEnv } from "./ai";
import type {
  BatchCreateRequest,
  BatchItemRecord,
  BatchRecord,
  BatchRunRequest,
  BatchRunResponse,
  BatchStatus,
  EndToEndWorkflowResponse,
} from "./domain";
import { runEndToEndWorkflow } from "./workflow";

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<unknown>;
}

interface BatchRow {
  id: string;
  status: BatchStatus;
  created_at: string;
  updated_at: string;
}

interface BatchItemRow {
  id: string;
  batch_id: string;
  position: number;
  theme: string;
  status: BatchItemRecord["status"];
  request_json: string;
  result_json: string | null;
  error_text: string | null;
  created_at: string;
  updated_at: string;
}

export interface BatchStore {
  create(batch: BatchRecord): Promise<void>;
  get(batchId: string): Promise<BatchRecord | null>;
  setBatchStatus(batchId: string, status: BatchStatus, updatedAt: string): Promise<void>;
  setItemRunning(batchId: string, itemId: string, updatedAt: string): Promise<void>;
  setItemCompleted(
    batchId: string,
    itemId: string,
    result: EndToEndWorkflowResponse,
    updatedAt: string,
  ): Promise<void>;
  setItemFailed(batchId: string, itemId: string, error: string, updatedAt: string): Promise<void>;
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Stored ${label} JSON is invalid.`);
  }
}

function toItem(row: BatchItemRow): BatchItemRecord {
  return {
    id: row.id,
    batchId: row.batch_id,
    position: row.position,
    theme: row.theme,
    status: row.status,
    request: parseJson(row.request_json, "batch item request"),
    result: row.result_json ? parseJson(row.result_json, "batch item result") : undefined,
    error: row.error_text ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function summarize(row: BatchRow, items: BatchItemRecord[]): BatchRecord {
  const completedCount = items.filter((item) => item.status === "completed").length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  const pendingCount = items.filter((item) => item.status === "pending" || item.status === "running").length;

  return {
    id: row.id,
    status: row.status,
    totalCount: items.length,
    completedCount,
    failedCount,
    pendingCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
  };
}

export class D1BatchStore implements BatchStore {
  constructor(private readonly db: D1DatabaseLike) {}

  async create(batch: BatchRecord): Promise<void> {
    const statements: D1PreparedStatementLike[] = [
      this.db
        .prepare("INSERT INTO batches (id, status, created_at, updated_at) VALUES (?, ?, ?, ?)")
        .bind(batch.id, batch.status, batch.createdAt, batch.updatedAt),
    ];

    for (const item of batch.items) {
      statements.push(
        this.db
          .prepare(
            "INSERT INTO batch_items (id, batch_id, position, theme, status, request_json, result_json, error_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)",
          )
          .bind(
            item.id,
            batch.id,
            item.position,
            item.theme,
            item.status,
            JSON.stringify(item.request),
            item.createdAt,
            item.updatedAt,
          ),
      );
    }

    await this.db.batch(statements);
  }

  async get(batchId: string): Promise<BatchRecord | null> {
    const row = await this.db
      .prepare("SELECT id, status, created_at, updated_at FROM batches WHERE id = ?")
      .bind(batchId)
      .first<BatchRow>();
    if (!row) return null;

    const itemRows = await this.db
      .prepare(
        "SELECT id, batch_id, position, theme, status, request_json, result_json, error_text, created_at, updated_at FROM batch_items WHERE batch_id = ? ORDER BY position ASC",
      )
      .bind(batchId)
      .all<BatchItemRow>();

    return summarize(row, itemRows.results.map(toItem));
  }

  async setBatchStatus(batchId: string, status: BatchStatus, updatedAt: string): Promise<void> {
    await this.db
      .prepare("UPDATE batches SET status = ?, updated_at = ? WHERE id = ?")
      .bind(status, updatedAt, batchId)
      .run();
  }

  async setItemRunning(batchId: string, itemId: string, updatedAt: string): Promise<void> {
    await this.db
      .prepare(
        "UPDATE batch_items SET status = 'running', error_text = NULL, updated_at = ? WHERE batch_id = ? AND id = ? AND status = 'pending'",
      )
      .bind(updatedAt, batchId, itemId)
      .run();
  }

  async setItemCompleted(
    batchId: string,
    itemId: string,
    result: EndToEndWorkflowResponse,
    updatedAt: string,
  ): Promise<void> {
    await this.db
      .prepare(
        "UPDATE batch_items SET status = 'completed', result_json = ?, error_text = NULL, updated_at = ? WHERE batch_id = ? AND id = ?",
      )
      .bind(JSON.stringify(result), updatedAt, batchId, itemId)
      .run();
  }

  async setItemFailed(batchId: string, itemId: string, error: string, updatedAt: string): Promise<void> {
    await this.db
      .prepare(
        "UPDATE batch_items SET status = 'failed', result_json = NULL, error_text = ?, updated_at = ? WHERE batch_id = ? AND id = ?",
      )
      .bind(error.slice(0, 2000), updatedAt, batchId, itemId)
      .run();
  }
}

const MAX_BATCH_ITEMS = 20;
const MAX_ITEMS_PER_RUN = 3;

function clampRunCount(value?: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(MAX_ITEMS_PER_RUN, Math.trunc(value!)));
}

function validateCreate(input: BatchCreateRequest): void {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("items must contain at least one workflow request.");
  }
  if (input.items.length > MAX_BATCH_ITEMS) {
    throw new Error(`items cannot exceed ${MAX_BATCH_ITEMS} per batch.`);
  }
  for (const [index, item] of input.items.entries()) {
    if (!item.theme?.trim()) throw new Error(`items[${index}].theme is required.`);
  }
}

export interface BatchServiceDependencies {
  now?: () => string;
  id?: () => string;
  runWorkflow?: typeof runEndToEndWorkflow;
}

export async function createBatch(
  input: BatchCreateRequest,
  store: BatchStore,
  deps: BatchServiceDependencies = {},
): Promise<BatchRecord> {
  validateCreate(input);
  const now = deps.now?.() ?? new Date().toISOString();
  const makeId = deps.id ?? (() => crypto.randomUUID());
  const batchId = makeId();

  const items: BatchItemRecord[] = input.items.map((request, position) => ({
    id: makeId(),
    batchId,
    position,
    theme: request.theme.trim(),
    status: "pending",
    request: { ...request, theme: request.theme.trim() },
    createdAt: now,
    updatedAt: now,
  }));

  const batch: BatchRecord = {
    id: batchId,
    status: "pending",
    totalCount: items.length,
    completedCount: 0,
    failedCount: 0,
    pendingCount: items.length,
    createdAt: now,
    updatedAt: now,
    items,
  };

  await store.create(batch);
  return batch;
}

function finalStatus(batch: BatchRecord): BatchStatus {
  if (batch.pendingCount > 0) return "running";
  if (batch.failedCount === 0) return "completed";
  if (batch.completedCount === 0) return "failed";
  return "partial_failed";
}

export async function runBatch(
  batchId: string,
  input: BatchRunRequest,
  env: AiEnv,
  store: BatchStore,
  deps: BatchServiceDependencies = {},
): Promise<BatchRunResponse> {
  const initial = await store.get(batchId);
  if (!initial) throw new Error("Batch not found.");

  const pending = initial.items
    .filter((item) => item.status === "pending")
    .slice(0, clampRunCount(input.maxItems));

  if (pending.length === 0) {
    return { batch: initial, processedItemIds: [] };
  }

  const now = deps.now ?? (() => new Date().toISOString());
  const runWorkflow = deps.runWorkflow ?? runEndToEndWorkflow;
  await store.setBatchStatus(batchId, "running", now());

  const processedItemIds: string[] = [];
  for (const item of pending) {
    await store.setItemRunning(batchId, item.id, now());
    try {
      const result = await runWorkflow(item.request, env);
      await store.setItemCompleted(batchId, item.id, result, now());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown batch item error";
      await store.setItemFailed(batchId, item.id, message, now());
    }
    processedItemIds.push(item.id);
  }

  const afterItems = await store.get(batchId);
  if (!afterItems) throw new Error("Batch disappeared after processing.");
  await store.setBatchStatus(batchId, finalStatus(afterItems), now());
  const final = await store.get(batchId);
  if (!final) throw new Error("Batch disappeared after status update.");

  return { batch: final, processedItemIds };
}
