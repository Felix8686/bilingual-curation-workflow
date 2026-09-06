export type SourceKind = "public_domain_literature" | "screen_dialogue";

export type RightsStatus =
  | "public_domain"
  | "public_domain_review_required"
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

export interface SourceCandidate {
  id: string;
  theme: string;
  sourceKind: SourceKind;
  provider: "gutendex" | "wikiquote";
  workTitle: string;
  creator?: string;
  sourceUrl: string;
  originalEn: string;
  contextNote?: string;
  rightsStatus: RightsStatus;
  sourceVerified: boolean;
  score: number;
}

export interface SourceSearchRequest {
  theme: string;
  query?: string;
  literatureQueries?: string[];
  screenWorks?: string[];
  sourceKinds?: SourceKind[];
  limitPerSource?: number;
}

export interface SourceSearchResponse {
  theme: string;
  query: string;
  candidates: SourceCandidate[];
  warnings: string[];
}
