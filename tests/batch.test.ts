import { describe, expect, it } from "vitest";
import {
  createBatch,
  runBatch,
  type BatchServiceDependencies,
  type BatchStore,
} from "../src/batch";
import type {
  BatchItemRecord,
  BatchRecord,
  BatchStatus,
  EndToEndWorkflowRequest,
  EndToEndWorkflowResponse,
} from "../src/domain";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class MemoryBatchStore implements BatchStore {
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
    copy.pendingCount = copy.items.filter(
      (item) => item.status === "pending" || item.status === "running",
    ).length;
    copy.totalCount = copy.items.length;
    return copy;
  }

  async setBatchStatus(batchId: string, status: BatchStatus, updatedAt: string): Promise<void> {
    const batch = this.mustGet(batchId);
    batch.status = status;
    batch.updatedAt = updatedAt;
  }

  async setItemRunning(batchId: string, itemId: string, updatedAt: string): Promise<void> {
    const item = this.mustItem(batchId, itemId);
    if (item.status === "pending") item.status = "running";
    item.error = undefined;
    item.updatedAt = updatedAt;
  }

  async setItemCompleted(
    batchId: string,
    itemId: string,
    result: EndToEndWorkflowResponse,
    updatedAt: string,
  ): Promise<void> {
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

  private mustGet(batchId: string): BatchRecord {
    const batch = this.batches.get(batchId);
    if (!batch) throw new Error("missing test batch");
    return batch;
  }

  private mustItem(batchId: string, itemId: string): BatchItemRecord {
    const item = this.mustGet(batchId).items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error("missing test item");
    return item;
  }
}

function workflowRequest(theme: string): EndToEndWorkflowRequest {
  return {
    theme,
    literatureQueries: ["Pride and Prejudice"],
    sourceKinds: ["public_domain_literature"],
    limitPerSource: 1,
    maxSelected: 1,
  };
}

function workflowResult(theme: string): EndToEndWorkflowResponse {
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

function deterministicDeps(): BatchServiceDependencies {
  let next = 0;
  return {
    now: () => "2026-09-05T20:00:00.000Z",
    id: () => `id-${++next}`,
  };
}

describe("batch pipeline", () => {
  it("creates a persisted batch with ordered pending items", async () => {
    const store = new MemoryBatchStore();
    const batch = await createBatch(
      { items: [workflowRequest("love"), workflowRequest("loneliness")] },
      store,
      deterministicDeps(),
    );

    expect(batch.status).toBe("pending");
    expect(batch.totalCount).toBe(2);
    expect(batch.items.map((item) => item.position)).toEqual([0, 1]);
    expect(batch.items.every((item) => item.status === "pending")).toBe(true);
  });

  it("processes at most three pending items per run", async () => {
    const store = new MemoryBatchStore();
    const deps = deterministicDeps();
    const batch = await createBatch(
      { items: ["a", "b", "c", "d", "e"].map(workflowRequest) },
      store,
      deps,
    );

    const result = await runBatch(
      batch.id,
      { maxItems: 99 },
      {},
      store,
      {
        ...deps,
        runWorkflow: async (input) => workflowResult(input.theme),
      },
    );

    expect(result.processedItemIds).toHaveLength(3);
    expect(result.batch.completedCount).toBe(3);
    expect(result.batch.pendingCount).toBe(2);
    expect(result.batch.status).toBe("running");
  });

  it("keeps successful results when another item fails", async () => {
    const store = new MemoryBatchStore();
    const deps = deterministicDeps();
    const batch = await createBatch(
      { items: [workflowRequest("love"), workflowRequest("bad-source")] },
      store,
      deps,
    );

    const result = await runBatch(
      batch.id,
      { maxItems: 2 },
      {},
      store,
      {
        ...deps,
        runWorkflow: async (input) => {
          if (input.theme === "bad-source") throw new Error("source unavailable");
          return workflowResult(input.theme);
        },
      },
    );

    expect(result.batch.status).toBe("partial_failed");
    expect(result.batch.completedCount).toBe(1);
    expect(result.batch.failedCount).toBe(1);
    expect(result.batch.items[0].result?.publicationDraft.publicationText).toContain("love original");
    expect(result.batch.items[1].error).toContain("source unavailable");
  });

  it("rejects batches larger than twenty items", async () => {
    const store = new MemoryBatchStore();
    await expect(
      createBatch({ items: Array.from({ length: 21 }, (_, index) => workflowRequest(`t-${index}`)) }, store),
    ).rejects.toThrow(/cannot exceed 20/i);
  });
});
