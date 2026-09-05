import { describe, expect, it } from "vitest";
import type {
  AiCurationRequest,
  AiCurationResponse,
  SourceCandidate,
  SourceSearchResponse,
} from "../src/domain";
import { runEndToEndWorkflow } from "../src/workflow";

function candidate(id: string, score = 1): SourceCandidate {
  return {
    id,
    theme: "love",
    sourceKind: id.startsWith("film") ? "screen_dialogue" : "public_domain_literature",
    provider: id.startsWith("film") ? "wikiquote" : "gutendex",
    workTitle: id.startsWith("film") ? "Before Sunrise" : "Pride and Prejudice",
    creator: id.startsWith("film") ? undefined : "Austen, Jane",
    sourceUrl: id.startsWith("film")
      ? "https://en.wikiquote.org/wiki/Before_Sunrise"
      : "https://www.gutenberg.org/ebooks/1342",
    originalEn: id.startsWith("film")
      ? "But loving someone, and being loved means so much to me."
      : "In vain I have struggled. It will not do.",
    rightsStatus: id.startsWith("film")
      ? "quotation_review_required"
      : "public_domain_review_required",
    sourceVerified: true,
    score,
  };
}

function sourceResult(candidates: SourceCandidate[]): SourceSearchResponse {
  return {
    theme: "love",
    query: "love",
    candidates,
    warnings: ["source warning"],
  };
}

function aiResult(selectedCandidate: SourceCandidate): AiCurationResponse {
  return {
    theme: "love",
    model: "mock-model",
    selected: [
      {
        ...selectedCandidate,
        translationZh: "【翻译】爱一个人，也被人爱，对我意义重大。",
        themeFitScore: 96,
        contextIndependenceScore: 93,
        selectionReason: "主题契合且可独立理解",
      },
    ],
    rejected: [],
    warnings: ["ai warning"],
  };
}

describe("runEndToEndWorkflow", () => {
  it("chains source discovery, AI curation and publication draft without altering English", async () => {
    const film = candidate("film-1", 10);
    const result = await runEndToEndWorkflow(
      { theme: "love", hook: "关于爱情的几段英文", maxSelected: 1 },
      {},
      {
        searchSourcesFn: async () => sourceResult([film]),
        curateWithAiFn: async () => aiResult(film),
      },
    );

    expect(result.candidateCount).toBe(1);
    expect(result.selectedCount).toBe(1);
    expect(result.publicationDraft.segmentCount).toBe(1);
    expect(result.publicationDraft.publicationText).toContain(film.originalEn);
    expect(result.publicationDraft.publicationText).toContain("【翻译】");
    expect(result.warnings).toContain("source warning");
    expect(result.warnings).toContain("ai warning");
  });

  it("does not force a draft when source discovery returns nothing", async () => {
    await expect(
      runEndToEndWorkflow(
        { theme: "love" },
        {},
        { searchSourcesFn: async () => sourceResult([]) },
      ),
    ).rejects.toThrow(/no candidates/i);
  });

  it("does not force a draft when AI selects nothing", async () => {
    const film = candidate("film-1");
    await expect(
      runEndToEndWorkflow(
        { theme: "love" },
        {},
        {
          searchSourcesFn: async () => sourceResult([film]),
          curateWithAiFn: async () => ({
            theme: "love",
            model: "mock-model",
            selected: [],
            rejected: [{ id: film.id, workTitle: film.workTitle, reason: "not strong enough" }],
            warnings: [],
          }),
        },
      ),
    ).rejects.toThrow(/selected no candidates/i);
  });

  it("sends at most 15 highest-scoring candidates to one AI call", async () => {
    const candidates = Array.from({ length: 20 }, (_, index) => candidate(`lit-${index}`, index));
    let received: AiCurationRequest | undefined;

    await runEndToEndWorkflow(
      { theme: "love", maxSelected: 1 },
      {},
      {
        searchSourcesFn: async () => sourceResult(candidates),
        curateWithAiFn: async (input) => {
          received = input;
          return aiResult(input.candidates[0]);
        },
      },
    );

    expect(received?.candidates).toHaveLength(15);
    expect(received?.candidates[0].score).toBe(19);
    expect(received?.candidates[14].score).toBe(5);
  });
});
