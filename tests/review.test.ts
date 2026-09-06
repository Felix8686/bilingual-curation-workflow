import { describe, expect, it } from "vitest";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1RunResultLike,
} from "../src/batch";
import { D1ReviewStore } from "../src/review";
import { reviewConsoleResponse } from "../src/review-console";

type Row = {
  id: string;
  batch_id: string;
  position: number;
  theme: string;
  status: "completed";
  review_status: "unreviewed" | "approved" | "held" | "published";
  review_note: string | null;
  reviewed_at: string | null;
  result_json: string;
  created_at: string;
  updated_at: string;
};

class Statement implements D1PreparedStatementLike {
  private values: unknown[] = [];
  constructor(private readonly db: MemoryDb, private readonly query: string) {}
  bind(...values: unknown[]): D1PreparedStatementLike {
    this.values = values;
    return this;
  }
  async run(): Promise<D1RunResultLike> {
    if (!/UPDATE batch_items/i.test(this.query)) return { meta: { changes: 0 } };
    const itemId = String(this.values[4]);
    const row = this.db.rows.find((candidate) => candidate.id === itemId);
    if (!row) return { meta: { changes: 0 } };
    row.review_status = this.values[0] as Row["review_status"];
    row.review_note = (this.values[1] as string | null) ?? null;
    row.reviewed_at = (this.values[2] as string | null) ?? null;
    row.updated_at = String(this.values[3]);
    return { meta: { changes: 1 } };
  }
  async first<T>(): Promise<T | null> {
    const itemId = String(this.values[0]);
    return (this.db.rows.find((row) => row.id === itemId) ?? null) as T | null;
  }
  async all<T>(): Promise<{ results: T[] }> {
    let rows = [...this.db.rows];
    if (/review_status = \?/i.test(this.query)) {
      rows = rows.filter((row) => row.review_status === this.values[0]);
    }
    const limit = Number(this.values[this.values.length - 1]);
    return { results: rows.slice(0, limit) as T[] };
  }
}

class MemoryDb implements D1DatabaseLike {
  rows: Row[] = [];
  prepare(query: string): D1PreparedStatementLike {
    return new Statement(this, query);
  }
  async batch(): Promise<unknown> {
    return undefined;
  }
}

function resultJson(theme: string): string {
  return JSON.stringify({
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
  });
}

function row(id: string, theme: string): Row {
  return {
    id,
    batch_id: "batch-1",
    position: 0,
    theme,
    status: "completed",
    review_status: "unreviewed",
    review_note: null,
    reviewed_at: null,
    result_json: resultJson(theme),
    created_at: "2026-09-06T02:00:00.000Z",
    updated_at: "2026-09-06T02:00:00.000Z",
  };
}

describe("review console", () => {
  it("lists completed drafts by review status", async () => {
    const db = new MemoryDb();
    db.rows.push(row("a", "love"), { ...row("b", "farewell"), review_status: "held" });
    const result = await new D1ReviewStore(db).list("unreviewed", 100);
    expect(result.count).toBe(1);
    expect(result.items[0].theme).toBe("love");
    expect(result.items[0].result.publicationDraft.publicationText).toContain("love original");
  });

  it("updates review status and note without altering publication result", async () => {
    const db = new MemoryDb();
    db.rows.push(row("a", "love"));
    const before = db.rows[0].result_json;
    const updated = await new D1ReviewStore(db).update(
      "a",
      { reviewStatus: "approved", note: "可发布，发布前再看版权 warning" },
      "2026-09-06T03:00:00.000Z",
    );
    expect(updated.reviewStatus).toBe("approved");
    expect(updated.reviewNote).toContain("版权");
    expect(db.rows[0].result_json).toBe(before);
  });

  it("rejects invalid review status", async () => {
    const db = new MemoryDb();
    db.rows.push(row("a", "love"));
    await expect(
      new D1ReviewStore(db).update("a", { reviewStatus: "deleted" as never }),
    ).rejects.toThrow(/reviewStatus must be/i);
  });

  it("serves a self-contained manual review UI", async () => {
    const response = reviewConsoleResponse();
    const html = await response.text();
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("双语策展审核台");
    expect(html).toContain("创建并入队");
    expect(html).toContain("复制待发布稿");
    expect(html).toContain("已发布");
  });

  it("emits syntactically valid inline JavaScript", async () => {
    const html = await reviewConsoleResponse().text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
    expect(script).toContain("split(/\\r?\\n/)");
    expect(script).toContain("+'\\n状态: '");
  });
});
