import type { D1DatabaseLike, D1RunResultLike } from "./batch";
import type {
  EndToEndWorkflowResponse,
  ReviewItemRecord,
  ReviewListResponse,
  ReviewStatus,
  ReviewUpdateRequest,
} from "./domain";

interface ReviewRow {
  id: string;
  batch_id: string;
  position: number;
  theme: string;
  status: ReviewItemRecord["status"];
  review_status: ReviewStatus;
  review_note: string | null;
  reviewed_at: string | null;
  result_json: string;
  created_at: string;
  updated_at: string;
}

const REVIEW_STATUSES: ReviewStatus[] = ["unreviewed", "approved", "held", "published"];

function parseResult(value: string): EndToEndWorkflowResponse {
  try {
    return JSON.parse(value) as EndToEndWorkflowResponse;
  } catch {
    throw new Error("Stored review result JSON is invalid.");
  }
}

function toRecord(row: ReviewRow): ReviewItemRecord {
  return {
    id: row.id,
    batchId: row.batch_id,
    position: row.position,
    theme: row.theme,
    status: row.status,
    reviewStatus: row.review_status,
    reviewNote: row.review_note ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    result: parseResult(row.result_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function clampLimit(value?: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(100, Math.trunc(value!)));
}

function isReviewStatus(value: unknown): value is ReviewStatus {
  return typeof value === "string" && REVIEW_STATUSES.includes(value as ReviewStatus);
}

function changed(result: D1RunResultLike): boolean {
  return (result.meta?.changes ?? 0) > 0;
}

export class D1ReviewStore {
  constructor(private readonly db: D1DatabaseLike) {}

  async list(status?: string, limit?: number): Promise<ReviewListResponse> {
    if (status && status !== "all" && !isReviewStatus(status)) {
      throw new Error("Invalid review status filter.");
    }

    const sqlBase = `
      SELECT id, batch_id, position, theme, status, review_status, review_note,
             reviewed_at, result_json, created_at, updated_at
      FROM batch_items
      WHERE status = 'completed' AND result_json IS NOT NULL`;

    const statement = status && status !== "all"
      ? this.db
          .prepare(`${sqlBase} AND review_status = ? ORDER BY updated_at DESC LIMIT ?`)
          .bind(status, clampLimit(limit))
      : this.db
          .prepare(`${sqlBase} ORDER BY updated_at DESC LIMIT ?`)
          .bind(clampLimit(limit));

    const rows = await statement.all<ReviewRow>();
    return { items: rows.results.map(toRecord), count: rows.results.length };
  }

  async get(itemId: string): Promise<ReviewItemRecord | null> {
    const row = await this.db
      .prepare(`
        SELECT id, batch_id, position, theme, status, review_status, review_note,
               reviewed_at, result_json, created_at, updated_at
        FROM batch_items
        WHERE id = ? AND status = 'completed' AND result_json IS NOT NULL`)
      .bind(itemId)
      .first<ReviewRow>();
    return row ? toRecord(row) : null;
  }

  async update(
    itemId: string,
    input: ReviewUpdateRequest,
    reviewedAt = new Date().toISOString(),
  ): Promise<ReviewItemRecord> {
    if (!isReviewStatus(input.reviewStatus)) {
      throw new Error("reviewStatus must be unreviewed, approved, held, or published.");
    }

    const note = typeof input.note === "string" ? input.note.trim().slice(0, 2000) : "";
    const timestamp = input.reviewStatus === "unreviewed" ? null : reviewedAt;
    const result = await this.db
      .prepare(`
        UPDATE batch_items
        SET review_status = ?, review_note = ?, reviewed_at = ?, updated_at = ?
        WHERE id = ? AND status = 'completed' AND result_json IS NOT NULL`)
      .bind(input.reviewStatus, note || null, timestamp, reviewedAt, itemId)
      .run();

    if (!changed(result)) {
      throw new Error("Review item not found or is not completed.");
    }

    const updated = await this.get(itemId);
    if (!updated) throw new Error("Review item disappeared after update.");
    return updated;
  }
}
