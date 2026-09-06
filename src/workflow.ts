import { curateWithAi, type AiEnv } from "./ai";
import { buildPublicationDraft } from "./curation";
import type {
  CuratedSegment,
  EndToEndWorkflowRequest,
  EndToEndWorkflowResponse,
  SourceCandidate,
} from "./domain";
import { searchSources } from "./sources";

const MAX_AI_CANDIDATES = 15;

export interface WorkflowDependencies {
  searchSourcesFn?: typeof searchSources;
  curateWithAiFn?: typeof curateWithAi;
}

function uniqueWarnings(...groups: string[][]): string[] {
  return Array.from(new Set(groups.flat().filter(Boolean)));
}

function toCuratedSegment(candidate: EndToEndWorkflowResponse["selected"][number]): CuratedSegment {
  return {
    id: candidate.id,
    theme: candidate.theme,
    sourceKind: candidate.sourceKind,
    workTitle: candidate.workTitle,
    creator: candidate.creator,
    sourceUrl: candidate.sourceUrl,
    originalEn: candidate.originalEn,
    translationZh: candidate.translationZh,
    contextNote: candidate.contextNote,
    rightsStatus: candidate.rightsStatus,
    sourceVerified: candidate.sourceVerified,
  };
}

function topCandidates(candidates: SourceCandidate[]): SourceCandidate[] {
  return [...candidates]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_AI_CANDIDATES);
}

export async function runEndToEndWorkflow(
  input: EndToEndWorkflowRequest,
  env: AiEnv,
  deps: WorkflowDependencies = {},
): Promise<EndToEndWorkflowResponse> {
  const theme = input.theme?.trim();
  if (!theme) throw new Error("theme is required.");

  const searchFn = deps.searchSourcesFn ?? searchSources;
  const curateFn = deps.curateWithAiFn ?? curateWithAi;

  const sourceResult = await searchFn({
    theme,
    query: input.query,
    literatureQueries: input.literatureQueries,
    screenWorks: input.screenWorks,
    sourceKinds: input.sourceKinds,
    limitPerSource: input.limitPerSource,
  });

  if (sourceResult.candidates.length === 0) {
    throw new Error("Source search returned no candidates. Refine the theme or source queries instead of forcing a draft.");
  }

  const aiInputCandidates = topCandidates(sourceResult.candidates);
  const aiResult = await curateFn(
    {
      theme,
      candidates: aiInputCandidates,
      maxSelected: input.maxSelected,
    },
    env,
  );

  if (aiResult.selected.length === 0) {
    throw new Error("AI curation selected no candidates. Do not force low-quality content into a publication draft.");
  }

  const publicationDraft = buildPublicationDraft({
    theme,
    hook: input.hook,
    segments: aiResult.selected.map(toCuratedSegment),
  });

  return {
    theme,
    query: sourceResult.query,
    model: aiResult.model,
    candidateCount: sourceResult.candidates.length,
    selectedCount: aiResult.selected.length,
    rejectedCount: aiResult.rejected.length,
    selected: aiResult.selected,
    rejected: aiResult.rejected,
    publicationDraft,
    warnings: uniqueWarnings(sourceResult.warnings, aiResult.warnings, publicationDraft.warnings),
  };
}
