import { describe, expect, it } from "vitest";
import app from "../src/index";

describe("production access guard", () => {
  it("blocks HTTP requests when production Access is required but ctx.access is absent", async () => {
    const response = await app.fetch(
      new Request("https://example.test/health"),
      { REQUIRE_ACCESS: "true" },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Cloudflare Access authentication is required.",
    });
  });

  it("allows requests when runtime Access context exists", async () => {
    const response = await app.fetch(
      new Request("https://example.test/health"),
      { REQUIRE_ACCESS: "true" },
      { access: {} },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "bilingual-curation-workflow",
    });
  });

  it("keeps local development unchanged when REQUIRE_ACCESS is unset", async () => {
    const response = await app.fetch(
      new Request("https://example.test/health"),
      {},
    );

    expect(response.status).toBe(200);
  });
});
