import { describe, expect, it } from "vitest";
import { createBatch, type BatchStore } from "../src/batch";
import type {
  BatchItemRecord,
  BatchQueueMessage,
  BatchRecord,
  BatchStatus,
  EndToEndWorkflowRequest,
  EndToEndWorkflowResponse,
} from "../src/domain";
import {
  consumeBatchQueue,
  enqueueBatch,
  type QueueMessageLike,
  type QueueProducerLike,
} from "../src/queue";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class MemoryStore implements BatchStore {
  private readonly batches = new Map<string, BatchRecord>();

  async create(batch: BatchRecord): Promise<void> {
    this.batches.set(batch.id, clone(batch));
  }

  async get(batchId: string): Promise<BatchRecord | null> {
    const batch = this.batches.get(batchId);
    if (!batch) return null;
    const copy = clone(batch);
    copy.completedCount = copy.items.filter((item) => item.status === "completed").length;
    copy.failedCount = copy.items.filter((item) => item.status === "failed").length;
    copy.pendingCount = copy.items.filter((item) => item.status === "pending" || item.status === "running").length;
    copy.totalCount = copy.items.length;
    return copy;
  }

  async setBatchStatus(batchId: string, status: BatchStatus, updatedAt: string): Promise<void> {
    const batch = this.mustBatch(batchId);
    batch.status = status;
    batch.updatedAt = updatedAt;
  }

  async setItemRunning(batchId: string, itemId: string, updatedAt: string): Promise<void> {
    const item = this.mustItem(batchId, itemId);
    if (item.status === "pending" && !item.queuedAt) item.status = "running";
    item.updatedAt = updatedAt;
  }

  async markItemQueued(batchId: string, itemId: string, queuedAt: string): Promise<boolean> {
    const item = this.mustItem(batchId, itemId);
    if (item.status !== "pending" || item.queuedAt) return false;
    item.queuedAt = queuedAt;
    item.updatedAt = queuedAt;
    return true;
  }

  async clearItemQueued(batchId: string, itemId: string, updatedAt: string): Promise<void> {
    const item = this.mustItem(batchId, itemId);
    if (item.status === "pending") item.queuedAt = undefined;
    item.updatedAt = updatedAt;
  }

  async claimQueuedItem(batchId: string, itemId: string, updatedAt: string): Promise<boolean> {
    const item = this.mustItem(batchId, itemId);
    if (item.status !== "pending" || !item.queuedAt) return false;
    item.status = "running";
    item.error = undefined;
    item.updatedAt = updatedAt;
    return true;
  }

  async resetQueuedItemForRetry(batchId: string, itemId: string, error: string, updatedAt: string): Promise<void> {
    const item = this.mustItem(batchId, itemId);
    if (item.status === "running") item.status = "pending";
    item.error = error;
    item.result = undefined;
    item.updatedAt = updatedAt;
  }

  async setItemCompleted(batchId: string, itemId: string, result: EndToEndWorkflowResponse, updatedAt: string): Promise<void> {
    const item = this.mustItem(batchId, itemId);
    item.status = "completed";
    item.result = clone(result);
    item.error = undefined;
    item.updatedAt = updatedAt;
  }

  async setItemFailed(batchId: string, itemId: string, error: string, updatedAt: string): Promise<void> {
    const item = this.mustItem(batchId, itemId);
    item.status = "failed";
    item.result = undefined;
    item.error = error;
    item.updatedAt = updatedAt;
  }

  private mustBatch(batchId: string): BatchRecord {
    const batch = this.batches.get(batchId);
    if (!batch) throw new Error("missing batch");
    return batch;
  }

  private mustItem(batchId: string, itemId: string): BatchItemRecord {
    const item = this.mustBatch(batchId).items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error("missing item");
    return item;
  }
}

class FakeQueue implements QueueProducerLike {
  readonly sent: BatchQueueMessage[] = [];
  async send(message: BatchQueueMessage): Promise<void> {
    this.sent.push(clone(message));
  }
}

class FakeMessage implements QueueMessageLike<BatchQueueMessage> {
  acked = false;
  retried = false;
  retryDelay?: number;

  constructor(public body: BatchQueueMessage, public attempts: number) {}

  ack(): void {
    this.acked = true;
  }

  retry(options?: { delaySeconds?: number }): void {
    this.retried = true;
    this.retryDelay = options?.delaySeconds;
  }
}

function request(theme: string): EndToEndWorkflowRequest {
  return {
    theme,
    literatureQueries: ["Pride and Prejudice"],
    sourceKinds: ["public_domain_literature"],
    limitPerSource: 1,
    maxSelected: 1,
  };
}

function result(theme: string): EndToEndWorkflowResponse {
  return {
    theme,
    query: theme,
    model: "mock-model",
    candidateCount: 1,
    selectedCount: 1,
    rejectedCount: 0,
    selected: [],
    rejected: [],
    publicationDraft: {
      theme,
      publicationText: `${theme} original\n\n${theme} 中文`,
      segmentCount: 1,
      warnings: [],
    },
    warnings: [],
  };
}

async function makeBatch(store: MemoryStore, themes = ["love", "marriage"]): Promise<BatchRecord> {
  let id = 0;
  return createBatch(
    { items: themes.map(request) },
    store,
    {
      id: () => `q-${++id}`,
      now: () => "2026-09-06T02:00:00.000Z",
    },
  );
}

describe("queue pipeline", () => {
  it("enqueues pending items once and records queuedAt", async () => {
    const store = new MemoryStore();
    const queue = new FakeQueue();
    const batch = await makeBatch(store);

    const first = await enqueueBatch(batch.id, { maxItems: 20 }, store, queue, {
      now: () => "2026-09-06T02:01:00.000Z",
    });
    const second = await enqueueBatch(batch.id, { maxItems: 20 }, store, queue, {
      now: () => "2026-09-06T02:02:00.000Z",
    });

    expect(first.enqueuedItemIds).toHaveLength(2);
    expect(first.batch.items.every((item) => Boolean(item.queuedAt))).toBe(true);
    expect(second.enqueuedItemIds).toHaveLength(0);
    expect(queue.sent).toHaveLength(2);
  });

  it("processes a queued item and ignores duplicate delivery", async () => {
    const store = new MemoryStore();
    const queue = new FakeQueue();
    const batch = await makeBatch(store, ["love"]);
    await enqueueBatch(batch.id, {}, store, queue);

    const message1 = new FakeMessage(queue.sent[0], 1);
    await consumeBatchQueue(
      { messages: [message1] },
      {},
      store,
      { runWorkflow: async (input) => result(input.theme) },
    );

    const duplicate = new FakeMessage(queue.sent[0], 1);
    await consumeBatchQueue(
      { messages: [duplicate] },
      {},
      store,
      { runWorkflow: async () => { throw new Error("duplicate must not execute"); } },
    );

    const saved = await store.get(batch.id);
    expect(saved?.status).toBe("completed");
    expect(saved?.completedCount).toBe(1);
    expect(message1.acked).toBe(true);
    expect(duplicate.acked).toBe(true);
    expect(duplicate.retried).toBe(false);
  });

  it("retries a failed item before the final attempt", async () => {
    const store = new MemoryStore();
    const queue = new FakeQueue();
    const batch = await makeBatch(store, ["love"]);
    await enqueueBatch(batch.id, {}, store, queue);

    const message = new FakeMessage(queue.sent[0], 1);
    await consumeBatchQueue(
      { messages: [message] },
      {},
      store,
      { runWorkflow: async () => { throw new Error("temporary provider failure"); } },
    );

    const saved = await store.get(batch.id);
    expect(saved?.items[0].status).toBe("pending");
    expect(saved?.items[0].queuedAt).toBeTruthy();
    expect(saved?.items[0].error).toContain("temporary provider failure");
    expect(message.retried).toBe(true);
    expect(message.retryDelay).toBe(10);
    expect(message.acked).toBe(false);
  });

  it("marks an item failed on the third unsuccessful delivery", async () => {
    const store = new MemoryStore();
    const queue = new FakeQueue();
    const batch = await makeBatch(store, ["love"]);
    await enqueueBatch(batch.id, {}, store, queue);

    const message = new FakeMessage(queue.sent[0], 3);
    await consumeBatchQueue(
      { messages: [message] },
      {},
      store,
      { runWorkflow: async () => { throw new Error("still failing"); } },
    );

    const saved = await store.get(batch.id);
    expect(saved?.status).toBe("failed");
    expect(saved?.failedCount).toBe(1);
    expect(saved?.items[0].error).toContain("still failing");
    expect(message.acked).toBe(true);
    expect(message.retried).toBe(false);
  });
});
