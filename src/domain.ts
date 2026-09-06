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

export interface AiCurationRequest {
  theme: string;
  candidates: SourceCandidate[];
  maxSelected?: number;
}

export interface AiDecision {
  id: string;
  selected: boolean;
  themeFitScore: number;
  contextIndependenceScore: number;
  reason: string;
  translationZh?: string;
}

export interface AiSelectedCandidate extends SourceCandidate {
  translationZh: string;
  themeFitScore: number;
  contextIndependenceScore: number;
  selectionReason: string;
}

export interface AiRejectedCandidate {
  id: string;
  workTitle: string;
  reason: string;
}

export interface AiCurationResponse {
  theme: string;
  model: string;
  selected: AiSelectedCandidate[];
  rejected: AiRejectedCandidate[];
  warnings: string[];
}

export interface EndToEndWorkflowRequest extends SourceSearchRequest {
  hook?: string;
  maxSelected?: number;
}

export interface EndToEndWorkflowResponse {
  theme: string;
  query: string;
  model: string;
  candidateCount: number;
  selectedCount: number;
  rejectedCount: number;
  selected: AiSelectedCandidate[];
  rejected: AiRejectedCandidate[];
  publicationDraft: PublicationDraft;
  warnings: string[];
}

export type BatchStatus = "pending" | "running" | "completed" | "partial_failed" | "failed";
export type BatchItemStatus = "pending" | "running" | "completed" | "failed";

export interface BatchCreateRequest {
  items: EndToEndWorkflowRequest[];
}

export interface BatchRunRequest {
  maxItems?: number;
}

export interface BatchEnqueueRequest {
  maxItems?: number;
}

export interface BatchQueueMessage {
  batchId: string;
  itemId: string;
}

export interface BatchItemRecord {
  id: string;
  batchId: string;
  position: number;
  theme: string;
  status: BatchItemStatus;
  request: EndToEndWorkflowRequest;
  result?: EndToEndWorkflowResponse;
  error?: string;
  queuedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BatchRecord {
  id: string;
  status: BatchStatus;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  pendingCount: number;
  createdAt: string;
  updatedAt: string;
  items: BatchItemRecord[];
}

export interface BatchRunResponse {
  batch: BatchRecord;
  processedItemIds: string[];
}

export interface BatchEnqueueResponse {
  batch: BatchRecord;
  enqueuedItemIds: string[];
}
