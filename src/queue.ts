import type { AiEnv } from "./ai";
import {
  type BatchStore,
  refreshBatchStatus,
} from "./batch";
import type {
  BatchEnqueueRequest,
  BatchEnqueueResponse,
  BatchQueueMessage,
} from "./domain";
import { runEndToEndWorkflow } from "./workflow";

export interface QueueProducerLike {
  send(message: BatchQueueMessage): Promise<unknown>;
}

export interface QueueMessageLike<T> {
  body: T;
  attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

export interface QueueMessageBatchLike<T> {
  messages: Array<QueueMessageLike<T>>;
}

export interface QueueServiceDependencies {
  now?: () => string;
  runWorkflow?: typeof runEndToEndWorkflow;
}

const MAX_ENQUEUE_ITEMS = 20;
const MAX_CONSUMER_ATTEMPTS = 3;

function clampEnqueueCount(value?: number): number {
  if (!Number.isFinite(value)) return MAX_ENQUEUE_ITEMS;
  return Math.max(1, Math.min(MAX_ENQUEUE_ITEMS, Math.trunc(value!)));
}

function isQueueMessage(value: unknown): value is BatchQueueMessage {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.batchId === "string" && item.batchId.length > 0 &&
    typeof item.itemId === "string" && item.itemId.length > 0;
}

export async function enqueueBatch(
  batchId: string,
  input: BatchEnqueueRequest,
  store: BatchStore,
  queue: QueueProducerLike,
  deps: QueueServiceDependencies = {},
): Promise<BatchEnqueueResponse> {
  const batch = await store.get(batchId);
  if (!batch) throw new Error("Batch not found.");

  const candidates = batch.items
    .filter((item) => item.status === "pending" && !item.queuedAt)
    .slice(0, clampEnqueueCount(input.maxItems));

  if (candidates.length === 0) {
    return { batch, enqueuedItemIds: [] };
  }

  const now = deps.now ?? (() => new Date().toISOString());
  const enqueuedItemIds: string[] = [];
  await store.setBatchStatus(batchId, "running", now());

  for (const item of candidates) {
    const marked = await store.markItemQueued(batchId, item.id, now());
    if (!marked) continue;

    try {
      await queue.send({ batchId, itemId: item.id });
      enqueuedItemIds.push(item.id);
    } catch (error) {
      await store.clearItemQueued(batchId, item.id, now());
      const message = error instanceof Error ? error.message : "Unknown queue producer error";
      throw new Error(`Queue publish failed for item ${item.id}: ${message}`);
    }
  }

  const updated = await store.get(batchId);
  if (!updated) throw new Error("Batch disappeared after enqueue.");
  return { batch: updated, enqueuedItemIds };
}

async function consumeOne(
  message: QueueMessageLike<BatchQueueMessage>,
  env: AiEnv,
  store: BatchStore,
  deps: QueueServiceDependencies,
): Promise<void> {
  if (!isQueueMessage(message.body)) {
    message.ack();
    return;
  }

  const { batchId, itemId } = message.body;
  const now = deps.now ?? (() => new Date().toISOString());
  const claimed = await store.claimQueuedItem(batchId, itemId, now());

  if (!claimed) {
    message.ack();
    return;
  }

  const batch = await store.get(batchId);
  const item = batch?.items.find((candidate) => candidate.id === itemId);
  if (!batch || !item) {
    message.ack();
    return;
  }

  const runWorkflow = deps.runWorkflow ?? runEndToEndWorkflow;
  try {
    const result = await runWorkflow(item.request, env);
    await store.setItemCompleted(batchId, itemId, result, now());
    await refreshBatchStatus(batchId, store, now());
    message.ack();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown queue item error";

    if (message.attempts < MAX_CONSUMER_ATTEMPTS) {
      await store.resetQueuedItemForRetry(batchId, itemId, detail, now());
      await store.setBatchStatus(batchId, "running", now());
      message.retry({ delaySeconds: 10 });
      return;
    }

    await store.setItemFailed(batchId, itemId, detail, now());
    await refreshBatchStatus(batchId, store, now());
    message.ack();
  }
}

export async function consumeBatchQueue(
  batch: QueueMessageBatchLike<BatchQueueMessage>,
  env: AiEnv,
  store: BatchStore,
  deps: QueueServiceDependencies = {},
): Promise<void> {
  for (const message of batch.messages) {
    await consumeOne(message, env, store, deps);
  }
}
