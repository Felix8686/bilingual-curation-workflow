import type {
  CuratedSegment,
  PublicationDraft,
  PublicationDraftInput,
} from "./domain";

const SEPARATOR = "──────────";

function normalizeBlock(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function validateSegment(segment: CuratedSegment): string[] {
  const warnings: string[] = [];

  if (!normalizeBlock(segment.originalEn)) {
    throw new Error(`Segment ${segment.id} is missing original English text.`);
  }

  if (!normalizeBlock(segment.translationZh)) {
    throw new Error(`Segment ${segment.id} is missing Chinese translation.`);
  }

  if (!segment.sourceVerified) {
    warnings.push(`Segment ${segment.id}: source has not been manually verified.`);
  }

  if (segment.rightsStatus === "unknown") {
    warnings.push(`Segment ${segment.id}: rights status is unknown.`);
  }

  if (segment.rightsStatus === "quotation_review_required") {
    warnings.push(`Segment ${segment.id}: quotation needs manual rights review before publishing.`);
  }

  return warnings;
}

function renderSegment(segment: CuratedSegment): string {
  const attribution = segment.creator
    ? `${segment.workTitle} · ${segment.creator}`
    : segment.workTitle;

  return [
    attribution,
    normalizeBlock(segment.originalEn),
    normalizeBlock(segment.translationZh),
  ].join("\n\n");
}

export function buildPublicationDraft(
  input: PublicationDraftInput,
): PublicationDraft {
  if (!input.theme.trim()) {
    throw new Error("Theme is required.");
  }

  if (input.segments.length === 0) {
    throw new Error("At least one curated segment is required.");
  }

  const warnings = input.segments.flatMap(validateSegment);
  const body = input.segments.map(renderSegment).join(`\n\n${SEPARATOR}\n\n`);
  const hook = input.hook?.trim();
  const publicationText = hook ? `${hook}\n\n${body}` : body;

  return {
    theme: input.theme.trim(),
    hook,
    publicationText,
    segmentCount: input.segments.length,
    warnings,
  };
}

export function assertOriginalPreserved(
  source: CuratedSegment,
  publicationText: string,
): void {
  const original = normalizeBlock(source.originalEn);
  if (!publicationText.includes(original)) {
    throw new Error(`Original text for segment ${source.id} was altered or removed.`);
  }
}
