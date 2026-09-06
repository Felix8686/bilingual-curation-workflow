import { describe, expect, it } from "vitest";
import { curateWithAi } from "../src/ai";
import type { AiCurationRequest, SourceCandidate } from "../src/domain";

const candidateA: SourceCandidate = {
  id: "film-a",
  theme: "love",
  sourceKind: "screen_dialogue",
  provider: "wikiquote",
  workTitle: "Before Sunrise",
  sourceUrl: "https://en.wikiquote.org/wiki/Before_Sunrise",
  originalEn: "But loving someone, and being loved means so much to me.",
  rightsStatus: "quotation_review_required",
  sourceVerified: true,
  score: 3,
};

const candidateB: SourceCandidate = {
  id: "lit-b",
  theme: "love",
  sourceKind: "public_domain_literature",
  provider: "gutendex",
  workTitle: "Pride and Prejudice",
  creator: "Austen, Jane",
  sourceUrl: "https://www.gutenberg.org/ebooks/1342",
  originalEn: "In vain I have struggled. It will not do. My feelings will not be repressed.",
  rightsStatus: "public_domain_review_required",
  sourceVerified: true,
  score: 2,
};

function request(): AiCurationRequest {
  return {
    theme: "love",
    maxSelected: 1,
    candidates: [candidateA, candidateB],
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const env = {
  AI_BASE_URL: "https://example.test/v1",
  AI_API_KEY: "test-key",
  AI_MODEL: "test-model",
};

describe("curateWithAi", () => {
  it("preserves original English and ranks selected candidates without allowing AI rewrite", async () => {
    let requestedBody = "";
    const mockFetch: typeof fetch = async (_input, init) => {
      requestedBody = String(init?.body ?? "");
      return jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                decisions: [
                  {
                    id: "film-a",
                    selected: true,
                    themeFitScore: 96,
                    contextIndependenceScore: 90,
                    reason: "主题直接且脱离剧情仍可理解",
                    translationZh: "但爱一个人，以及被爱，对我来说意义重大。",
                    originalEn: "THIS FIELD MUST BE IGNORED",
                  },
                  {
                    id: "lit-b",
                    selected: true,
                    themeFitScore: 88,
                    contextIndependenceScore: 80,
                    reason: "爱情表达强烈",
                    translationZh: "我徒劳地挣扎过。没有用。我的感情再也压抑不住。",
                  },
                ],
              }),
            },
          },
        ],
      });
    };

    const result = await curateWithAi(request(), env, mockFetch);

    expect(result.model).toBe("test-model");
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].id).toBe("film-a");
    expect(result.selected[0].originalEn).toBe(candidateA.originalEn);
    expect(result.selected[0].originalEn).not.toBe("THIS FIELD MUST BE IGNORED");
    expect(result.selected[0].translationZh).toContain("意义重大");
    expect(result.warnings[0]).toMatch(/manual rights\/context review/i);
    expect(result.rejected.some((item) => item.id === "lit-b")).toBe(true);

    const outbound = JSON.parse(requestedBody) as { messages: Array<{ content: string }> };
    expect(outbound.messages[0].content).toMatch(/Never rewrite or reproduce/i);
  });

  it("rejects a selected item when AI omits its Chinese translation", async () => {
    const mockFetch: typeof fetch = async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                decisions: [
                  {
                    id: "film-a",
                    selected: true,
                    themeFitScore: 99,
                    contextIndependenceScore: 99,
                    reason: "很好",
                  },
                  {
                    id: "lit-b",
                    selected: false,
                    themeFitScore: 30,
                    contextIndependenceScore: 50,
                    reason: "不选",
                  },
                ],
              }),
            },
          },
        ],
      });

    const result = await curateWithAi(request(), env, mockFetch);
    expect(result.selected).toHaveLength(0);
    expect(result.rejected.find((item) => item.id === "film-a")?.reason).toMatch(
      /did not provide a Chinese translation/i,
    );
  });

  it("refuses to call AI when provider configuration is missing", async () => {
    await expect(curateWithAi(request(), {}, fetch)).rejects.toThrow(
      /AI_BASE_URL, AI_API_KEY and AI_MODEL must be configured/i,
    );
  });
});
