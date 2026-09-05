export type SourceKind = "public_domain_literature" | "screen_dialogue";

export type RightsStatus =
  | "public_domain"
  | "quotation_review_required"
  | "cleared"
  | "unknown";

export interface CuratedSegment {
  id: string;
  theme: string;
  sourceKind: SourceKind;
  workTitle: string;
  creator?: string;
  sourceUrl?: string;
  originalEn: string;
  translationZh: string;
  contextNote?: string;
  rightsStatus: RightsStatus;
  sourceVerified: boolean;
}

export interface PublicationDraftInput {
  theme: string;
  hook?: string;
  segments: CuratedSegment[];
}

export interface PublicationDraft {
  theme: string;
  hook?: string;
  publicationText: string;
  segmentCount: number;
  warnings: string[];
}
