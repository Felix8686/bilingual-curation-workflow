import type {
  AiCurationRequest,
  AiCurationResponse,
  AiDecision,
  AiSelectedCandidate,
  SourceCandidate,
} from "./domain";

interface AiMessage {
  role: "system" | "user";
  content: string;
}

export interface WorkersAiBindingLike {
  run(
    model: string,
    input: {
      messages: AiMessage[];
      temperature?: number;
      max_tokens?: number;
    },
  ): Promise<unknown>;
}

export interface AiEnv {
  AI?: WorkersAiBindingLike;
  AI_BASE_URL?: string;
  AI_API_KEY?: string;
  AI_MODEL?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface DecisionEnvelope {
  decisions?: AiDecision[];
}

const MAX_SELECTED = 5;
const MAX_CANDIDATES = 15;

function clampScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampMaxSelected(value?: number): number {
  if (!Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(MAX_SELECTED, Math.trunc(value!)));
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function parseDecisions(raw: string): AiDecision[] {
  let parsed: DecisionEnvelope;
  try {
    parsed = JSON.parse(stripCodeFence(raw)) as DecisionEnvelope;
  } catch {
    throw new Error("AI response is not valid JSON.");
  }

  if (!Array.isArray(parsed.decisions)) {
    throw new Error("AI response is missing decisions array.");
  }

  return parsed.decisions.map((item) => ({
    id: String(item.id ?? ""),
    selected: item.selected === true,
    themeFitScore: clampScore(item.themeFitScore),
    contextIndependenceScore: clampScore(item.contextIndependenceScore),
    reason: typeof item.reason === "string" ? item.reason.trim() : "",
    translationZh:
      typeof item.translationZh === "string" ? item.translationZh.trim() : undefined,
  }));
}

function buildPrompt(input: AiCurationRequest): string {
  const candidates = input.candidates.map((candidate) => ({
    id: candidate.id,
    sourceKind: candidate.sourceKind,
    workTitle: candidate.workTitle,
    creator: candidate.creator,
    contextNote: candidate.contextNote,
    rightsStatus: candidate.rightsStatus,
    originalEn: candidate.originalEn,
  }));

  return JSON.stringify(
    {
      task: "curate_bilingual_reading_candidates",
      theme: input.theme,
      maxSelected: clampMaxSelected(input.maxSelected),
      candidates,
      rules: [
        "Judge whether each candidate strongly fits the requested theme.",
        "Judge whether the excerpt can be understood reasonably well without needing hidden plot or book context.",
        "For selected candidates, provide a faithful natural Simplified Chinese translation.",
        "Do not rewrite, paraphrase, shorten, improve, modernize, or reproduce the English original in your answer.",
        "Do not invent dialogue, context, attribution, or missing sentences.",
        "Selection quality matters more than selecting many items.",
      ],
      outputSchema: {
        decisions: [
          {
            id: "candidate id only",
            selected: true,
            themeFitScore: "integer 0-100",
            contextIndependenceScore: "integer 0-100",
            reason: "brief Chinese reason",
            translationZh: "faithful Simplified Chinese translation when selected; omit when rejected",
          },
        ],
      },
    },
    null,
    2,
  );
}

function validateInput(input: AiCurationRequest): void {
  if (!input.theme?.trim()) throw new Error("theme is required.");
  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    throw new Error("candidates must contain at least one item.");
  }
  if (input.candidates.length > MAX_CANDIDATES) {
    throw new Error(`candidates cannot exceed ${MAX_CANDIDATES} items per AI call.`);
  }

  const ids = new Set<string>();
  for (const candidate of input.candidates) {
    if (!candidate.id?.trim()) throw new Error("candidate id is required.");
    if (ids.has(candidate.id)) throw new Error(`duplicate candidate id: ${candidate.id}`);
    ids.add(candidate.id);
    if (!candidate.originalEn?.trim()) {
      throw new Error(`candidate ${candidate.id} is missing original English text.`);
    }
  }
}

function rightsWarning(candidate: SourceCandidate): string | undefined {
  if (candidate.rightsStatus === "quotation_review_required") {
    return `${candidate.workTitle}: screen dialogue still requires manual rights/context review before publishing.`;
  }
  if (candidate.rightsStatus === "public_domain_review_required") {
    return `${candidate.workTitle}: public-domain status still requires final jurisdiction review before publishing.`;
  }
  if (candidate.rightsStatus === "unknown") {
    return `${candidate.workTitle}: rights status is unknown and requires manual review.`;
  }
  return undefined;
}

function messagesFor(input: AiCurationRequest): AiMessage[] {
  return [
    {
      role: "system",
      content:
        "You are a conservative bilingual editor. Return JSON only. Never rewrite or reproduce the supplied English originals in your response. Your job is selection, scoring, and faithful Chinese translation only.",
    },
    {
      role: "user",
      content: buildPrompt(input),
    },
  ];
}

function extractAiContent(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;

  const choices = record.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (first && typeof first === "object") {
      const message = (first as Record<string, unknown>).message;
      if (message && typeof message === "object") {
        const content = (message as Record<string, unknown>).content;
        if (typeof content === "string") return content;
      }
    }
  }

  if (typeof record.response === "string") return record.response;
  if (record.response && typeof record.response === "object") {
    return JSON.stringify(record.response);
  }

  return undefined;
}

async function callLegacyOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: AiMessage[],
  fetchImpl: typeof fetch,
): Promise<string> {
  const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`AI provider request failed: HTTP ${response.status} ${detail}`.trim());
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI provider returned empty content.");
  return content;
}

async function callWorkersAi(
  binding: WorkersAiBindingLike,
  model: string,
  messages: AiMessage[],
): Promise<string> {
  let payload: unknown;
  try {
    payload = await binding.run(model, {
      messages,
      temperature: 0.1,
      max_tokens: 2000,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown Workers AI error";
    throw new Error(`Workers AI request failed: ${detail}`);
  }

  const content = extractAiContent(payload);
  if (!content) throw new Error("Workers AI returned empty content.");
  return content;
}

export async function curateWithAi(
  input: AiCurationRequest,
  env: AiEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<AiCurationResponse> {
  validateInput(input);

  const baseUrl = env.AI_BASE_URL?.trim();
  const apiKey = env.AI_API_KEY?.trim();
  const model = env.AI_MODEL?.trim();
  if (!model) {
    throw new Error("AI_MODEL must be configured.");
  }

  const messages = messagesFor(input);
  let content: string;

  // Local mock and future external providers intentionally take precedence when
  // explicitly configured. Production omits these values and uses env.AI.
  if (baseUrl || apiKey) {
    if (!baseUrl || !apiKey) {
      throw new Error("AI_BASE_URL and AI_API_KEY must both be configured when using an external AI provider.");
    }
    content = await callLegacyOpenAiCompatible(baseUrl, apiKey, model, messages, fetchImpl);
  } else if (env.AI) {
    content = await callWorkersAi(env.AI, model, messages);
  } else {
    throw new Error("Workers AI binding or AI_BASE_URL/AI_API_KEY must be configured.");
  }

  const decisions = parseDecisions(content);
  const byId = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const seen = new Set<string>();

  const accepted: Array<{ candidate: SourceCandidate; decision: AiDecision }> = [];
  const rejected: AiCurationResponse["rejected"] = [];

  for (const decision of decisions) {
    const candidate = byId.get(decision.id);
    if (!candidate || seen.has(decision.id)) continue;
    seen.add(decision.id);

    if (!decision.selected) {
      rejected.push({
        id: candidate.id,
        workTitle: candidate.workTitle,
        reason: decision.reason || "AI rejected this candidate.",
      });
      continue;
    }

    if (!decision.translationZh?.trim()) {
      rejected.push({
        id: candidate.id,
        workTitle: candidate.workTitle,
        reason: "AI selected the candidate but did not provide a Chinese translation.",
      });
      continue;
    }

    accepted.push({ candidate, decision });
  }

  for (const candidate of input.candidates) {
    if (!seen.has(candidate.id)) {
      rejected.push({
        id: candidate.id,
        workTitle: candidate.workTitle,
        reason: "AI did not return a decision for this candidate.",
      });
    }
  }

  const selected: AiSelectedCandidate[] = accepted
    .sort((a, b) => {
      const scoreA = a.decision.themeFitScore + a.decision.contextIndependenceScore;
      const scoreB = b.decision.themeFitScore + b.decision.contextIndependenceScore;
      return scoreB - scoreA;
    })
    .slice(0, clampMaxSelected(input.maxSelected))
    .map(({ candidate, decision }) => ({
      ...candidate,
      originalEn: candidate.originalEn,
      translationZh: decision.translationZh!,
      themeFitScore: decision.themeFitScore,
      contextIndependenceScore: decision.contextIndependenceScore,
      selectionReason: decision.reason,
    }));

  const selectedIds = new Set(selected.map((item) => item.id));
  for (const { candidate } of accepted) {
    if (!selectedIds.has(candidate.id)) {
      rejected.push({
        id: candidate.id,
        workTitle: candidate.workTitle,
        reason: "Candidate passed AI review but was outside maxSelected after ranking.",
      });
    }
  }

  const warnings = Array.from(
    new Set(selected.map(rightsWarning).filter((item): item is string => Boolean(item))),
  );

  return {
    theme: input.theme,
    model,
    selected,
    rejected,
    warnings,
  };
}
