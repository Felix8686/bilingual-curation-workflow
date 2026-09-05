import { describe, expect, it } from "vitest";
import { assertOriginalPreserved, buildPublicationDraft } from "../src/curation";
import type { CuratedSegment } from "../src/domain";

const literature: CuratedSegment = {
  id: "lit-1",
  theme: "love",
  sourceKind: "public_domain_literature",
  workTitle: "She Walks in Beauty",
  creator: "Lord Byron",
  originalEn: "She walks in beauty, like the night",
  translationZh: "她走在美中，如同夜色。",
  rightsStatus: "public_domain",
  sourceVerified: true,
};

const dialogue: CuratedSegment = {
  id: "film-1",
  theme: "love",
  sourceKind: "screen_dialogue",
  workTitle: "Example Film",
  originalEn: "Do you still believe in love?\nI think I do.",
  translationZh: "你还相信爱情吗？\n我想，我相信。",
  rightsStatus: "quotation_review_required",
  sourceVerified: true,
};

describe("buildPublicationDraft", () => {
  it("keeps original English unchanged and separates works", () => {
    const draft = buildPublicationDraft({
      theme: "love",
      hook: "关于爱情的几段英文",
      segments: [literature, dialogue],
    });

    expect(draft.segmentCount).toBe(2);
    expect(draft.publicationText).toContain("──────────");
    expect(draft.publicationText).toContain(literature.originalEn);
    expect(draft.publicationText).toContain(dialogue.originalEn);
    expect(draft.warnings).toHaveLength(1);
    assertOriginalPreserved(literature, draft.publicationText);
    assertOriginalPreserved(dialogue, draft.publicationText);
  });

  it("rejects empty source text", () => {
    expect(() =>
      buildPublicationDraft({
        theme: "love",
        segments: [{ ...literature, originalEn: "   " }],
      }),
    ).toThrow(/missing original English text/i);
  });
});
