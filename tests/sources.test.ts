import { describe, expect, it } from "vitest";
import { searchSources } from "../src/sources";

function mockFetch(handler: (url: string) => Response): typeof fetch {
  return (async (input: RequestInfo | URL) => handler(String(input))) as typeof fetch;
}

describe("searchSources", () => {
  it("extracts a theme-matching Project Gutenberg literature candidate", async () => {
    const fetcher = mockFetch((url) => {
      if (url.startsWith("https://gutendex.com/books")) {
        return Response.json({
          results: [
            {
              id: 123,
              title: "A Public Domain Book",
              authors: [{ name: "Example, Author" }],
              languages: ["en"],
              formats: { "text/plain; charset=utf-8": "https://example.test/book.txt" },
            },
          ],
        });
      }

      if (url === "https://example.test/book.txt") {
        return new Response(
          "*** START OF THE PROJECT GUTENBERG EBOOK TEST ***\n\n" +
            "This paragraph is long enough to be considered but it does not contain the requested emotional theme at all. It only exists as background text for the test.\n\n" +
            "Love can arrive quietly, and sometimes love remains after every argument has ended. This paragraph is intentionally long enough to become the selected candidate passage for the workflow.\n\n" +
            "*** END OF THE PROJECT GUTENBERG EBOOK TEST ***",
        );
      }

      return new Response("not found", { status: 404 });
    });

    const result = await searchSources(
      {
        theme: "love",
        sourceKinds: ["public_domain_literature"],
        limitPerSource: 1,
      },
      fetcher,
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].provider).toBe("gutendex");
    expect(result.candidates[0].originalEn).toContain("Love can arrive quietly");
    expect(result.candidates[0].rightsStatus).toBe("public_domain_review_required");
    expect(result.warnings.join(" ")).toMatch(/public-domain check/i);
  });

  it("uses explicitly supplied screen works and keeps Wikiquote wording as a candidate block", async () => {
    const fetcher = mockFetch((url) => {
      if (url.startsWith("https://en.wikiquote.org/w/api.php") && url.includes("action=parse")) {
        return Response.json({
          parse: {
            title: "Example Film",
            wikitext: {
              "*": [
                "* A general quote that is not about the requested theme but is long enough to remain eligible.",
                ":'''Alex''': Do you believe love can survive all this?",
                ":'''Sam''': I do. I think love changes, but that does not mean it disappears.",
                ":'''Alex''': Then maybe we should stop pretending we are already finished.",
              ].join("\n"),
            },
          },
        });
      }

      return new Response("not found", { status: 404 });
    });

    const result = await searchSources(
      {
        theme: "love",
        sourceKinds: ["screen_dialogue"],
        screenWorks: ["Example Film"],
        limitPerSource: 1,
      },
      fetcher,
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].provider).toBe("wikiquote");
    expect(result.candidates[0].workTitle).toBe("Example Film");
    expect(result.candidates[0].originalEn).toContain("Do you believe love can survive all this?");
    expect(result.candidates[0].originalEn).toContain("I think love changes");
    expect(result.candidates[0].rightsStatus).toBe("quotation_review_required");
    expect(result.warnings.join(" ")).toMatch(/manual rights\/context review/i);
  });

  it("requires a theme", async () => {
    await expect(searchSources({ theme: " " }, mockFetch(() => new Response("")))).rejects.toThrow(
      /theme is required/i,
    );
  });
});
