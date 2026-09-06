import type {
  SourceCandidate,
  SourceKind,
  SourceSearchRequest,
  SourceSearchResponse,
} from "./domain";

type FetchLike = typeof fetch;

interface GutendexAuthor {
  name: string;
}

interface GutendexBook {
  id: number;
  title: string;
  authors: GutendexAuthor[];
  languages: string[];
  formats: Record<string, string>;
}

interface GutendexResponse {
  results: GutendexBook[];
}

interface WikiquoteSearchResponse {
  query?: {
    search?: Array<{ title: string }>;
  };
}

interface WikiquoteParseResponse {
  parse?: {
    title?: string;
    wikitext?: { "*"?: string };
  };
}

const MAX_LIMIT_PER_SOURCE = 5;
const MAX_EXCERPT_CHARS = 900;

function clampLimit(value?: number): number {
  if (!Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(MAX_LIMIT_PER_SOURCE, Math.trunc(value!)));
}

function searchTerms(theme: string, query: string): string[] {
  return Array.from(
    new Set(
      `${theme} ${query}`
        .toLowerCase()
        .split(/[^a-z0-9']+/)
        .map((part) => part.trim())
        .filter((part) => part.length >= 3),
    ),
  );
}

function scoreText(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    const matches = lower.match(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "g"));
    score += matches?.length ?? 0;
  }
  return score;
}

function trimExcerpt(text: string): string {
  const compact = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
  if (compact.length <= MAX_EXCERPT_CHARS) return compact;
  const slice = compact.slice(0, MAX_EXCERPT_CHARS);
  const lastBoundary = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("? "), slice.lastIndexOf("! "));
  return `${(lastBoundary > 200 ? slice.slice(0, lastBoundary + 1) : slice).trim()}…`;
}

function extractLiteratureExcerpt(text: string, terms: string[]): string {
  const normalized = text
    .replace(/\r/g, "")
    .replace(/\*\*\* START OF THE PROJECT GUTENBERG EBOOK[\s\S]*?\*\*\*/i, "")
    .replace(/\*\*\* END OF THE PROJECT GUTENBERG EBOOK[\s\S]*/i, "");

  const paragraphs = normalized
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/\n+/g, " ").replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length >= 80 && paragraph.length <= 2200);

  if (paragraphs.length === 0) return "";

  let best = paragraphs[0];
  let bestScore = -1;
  for (const paragraph of paragraphs) {
    const score = scoreText(paragraph, terms);
    if (score > bestScore) {
      best = paragraph;
      bestScore = score;
    }
  }

  return trimExcerpt(best);
}

function choosePlainTextUrl(formats: Record<string, string>): string | undefined {
  const preferred = [
    "text/plain; charset=utf-8",
    "text/plain; charset=us-ascii",
    "text/plain",
  ];
  for (const key of preferred) {
    const value = formats[key];
    if (value) return value.replace(/^http:/, "https:");
  }
  const fallback = Object.entries(formats).find(([key, value]) => key.startsWith("text/plain") && Boolean(value));
  return fallback?.[1]?.replace(/^http:/, "https:");
}

function cleanWikiMarkup(value: string): string {
  return value
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[(https?:\/\/\S+)\s+([^\]]+)\]/g, "$2")
    .replace(/'{2,5}/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractWikiquoteExcerpt(wikitext: string, terms: string[]): string {
  const lines = wikitext
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => /^[:*#]+/.test(line.trim()))
    .map((line) => cleanWikiMarkup(line.replace(/^[:*#]+\s*/, "")))
    .filter((line) => line.length >= 15 && line.length <= 600)
    .filter((line) => !/^(see also|external links|references|notes|cast)$/i.test(line));

  if (lines.length === 0) return "";

  let bestIndex = 0;
  let bestScore = -1;
  lines.forEach((line, index) => {
    const score = scoreText(line, terms);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  const start = Math.max(0, bestIndex - 2);
  const selected = lines.slice(start, Math.min(lines.length, start + 5));
  return trimExcerpt(selected.join("\n"));
}

async function searchGutendex(
  theme: string,
  query: string,
  limit: number,
  fetcher: FetchLike,
): Promise<SourceCandidate[]> {
  const url = new URL("https://gutendex.com/books");
  url.searchParams.set("search", query);
  url.searchParams.set("languages", "en");

  const response = await fetcher(url.toString(), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Gutendex search failed: HTTP ${response.status}`);
  const data = (await response.json()) as GutendexResponse;
  const terms = searchTerms(theme, query);
  const books = data.results.slice(0, limit);

  const candidates: SourceCandidate[] = [];
  for (const book of books) {
    const textUrl = choosePlainTextUrl(book.formats);
    if (!textUrl) continue;

    const textResponse = await fetcher(textUrl, { headers: { accept: "text/plain" } });
    if (!textResponse.ok) continue;
    const originalEn = extractLiteratureExcerpt(await textResponse.text(), terms);
    if (!originalEn) continue;

    candidates.push({
      id: `gutendex-${book.id}`,
      theme,
      sourceKind: "public_domain_literature",
      provider: "gutendex",
      workTitle: book.title,
      creator: book.authors.map((author) => author.name).join("; ") || undefined,
      sourceUrl: `https://www.gutenberg.org/ebooks/${book.id}`,
      originalEn,
      contextNote: `Excerpt selected from Project Gutenberg plain text for query: ${query}`,
      rightsStatus: "public_domain_review_required",
      sourceVerified: true,
      score: scoreText(originalEn, terms),
    });
  }

  return candidates;
}

async function searchWikiquoteTitles(query: string, limit: number, fetcher: FetchLike): Promise<string[]> {
  const url = new URL("https://en.wikiquote.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("srnamespace", "0");
  url.searchParams.set("srlimit", String(limit));
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const response = await fetcher(url.toString(), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Wikiquote search failed: HTTP ${response.status}`);
  const data = (await response.json()) as WikiquoteSearchResponse;
  return data.query?.search?.map((item) => item.title).slice(0, limit) ?? [];
}

async function fetchWikiquoteCandidate(
  theme: string,
  pageTitle: string,
  query: string,
  fetcher: FetchLike,
): Promise<SourceCandidate | null> {
  const url = new URL("https://en.wikiquote.org/w/api.php");
  url.searchParams.set("action", "parse");
  url.searchParams.set("page", pageTitle);
  url.searchParams.set("prop", "wikitext");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const response = await fetcher(url.toString(), { headers: { accept: "application/json" } });
  if (!response.ok) return null;
  const data = (await response.json()) as WikiquoteParseResponse;
  const wikitext = data.parse?.wikitext?.["*"];
  if (!wikitext) return null;

  const terms = searchTerms(theme, query);
  const originalEn = extractWikiquoteExcerpt(wikitext, terms);
  if (!originalEn) return null;
  const title = data.parse?.title || pageTitle;

  return {
    id: `wikiquote-${encodeURIComponent(title.toLowerCase().replace(/\s+/g, "-"))}`,
    theme,
    sourceKind: "screen_dialogue",
    provider: "wikiquote",
    workTitle: title,
    sourceUrl: `https://en.wikiquote.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
    originalEn,
    contextNote: `Candidate quotation block from English Wikiquote. Verify scene context and exact wording before publishing.`,
    rightsStatus: "quotation_review_required",
    sourceVerified: true,
    score: scoreText(originalEn, terms),
  };
}

async function searchWikiquote(
  theme: string,
  query: string,
  screenWorks: string[] | undefined,
  limit: number,
  fetcher: FetchLike,
): Promise<SourceCandidate[]> {
  const titles = screenWorks?.length
    ? screenWorks.slice(0, limit)
    : await searchWikiquoteTitles(query, limit, fetcher);

  const results = await Promise.all(
    titles.map((title) => fetchWikiquoteCandidate(theme, title, query, fetcher)),
  );
  return results.filter((candidate): candidate is SourceCandidate => candidate !== null);
}

export async function searchSources(
  input: SourceSearchRequest,
  fetcher: FetchLike = fetch,
): Promise<SourceSearchResponse> {
  const theme = input.theme?.trim();
  if (!theme) throw new Error("theme is required");

  const query = input.query?.trim() || theme;
  const limit = clampLimit(input.limitPerSource);
  const sourceKinds: SourceKind[] = input.sourceKinds?.length
    ? input.sourceKinds
    : ["public_domain_literature", "screen_dialogue"];

  const candidates: SourceCandidate[] = [];
  const warnings: string[] = [];

  if (sourceKinds.includes("public_domain_literature")) {
    const literatureQueries = input.literatureQueries?.filter(Boolean).slice(0, 3) || [query];
    for (const literatureQuery of literatureQueries) {
      try {
        candidates.push(...(await searchGutendex(theme, literatureQuery, limit, fetcher)));
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : "Gutendex source failed");
      }
    }
  }

  if (sourceKinds.includes("screen_dialogue")) {
    try {
      candidates.push(...(await searchWikiquote(theme, query, input.screenWorks, limit, fetcher)));
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "Wikiquote source failed");
    }
  }

  const deduped = Array.from(new Map(candidates.map((candidate) => [candidate.id, candidate])).values())
    .sort((a, b) => b.score - a.score);

  if (deduped.some((candidate) => candidate.rightsStatus === "quotation_review_required")) {
    warnings.push("Screen dialogue candidates require manual rights/context review before publishing.");
  }
  if (deduped.some((candidate) => candidate.rightsStatus === "public_domain_review_required")) {
    warnings.push("Project Gutenberg candidates require a final public-domain check for the publishing jurisdiction.");
  }

  return { theme, query, candidates: deduped, warnings };
}
