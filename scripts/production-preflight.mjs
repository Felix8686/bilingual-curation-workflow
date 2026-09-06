import { readFile } from "node:fs/promises";

const configPath = process.argv[2] || "wrangler.production.toml";
let text;
try {
  text = await readFile(configPath, "utf8");
} catch (error) {
  console.error(`FAIL: cannot read ${configPath}: ${error.message}`);
  process.exit(1);
}

const failures = [];
const requireMatch = (pattern, message) => {
  if (!pattern.test(text)) failures.push(message);
};

if (text.includes("REPLACE_WITH_PRODUCTION_D1_ID")) {
  failures.push("production D1 database_id is still a placeholder");
}

requireMatch(
  /database_id\s*=\s*"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"/,
  "production D1 database_id must be a UUID",
);
requireMatch(
  /REQUIRE_ACCESS\s*=\s*"true"/,
  'REQUIRE_ACCESS must be exactly "true"',
);
requireMatch(
  /\[ai\][\s\S]*?binding\s*=\s*"AI"/,
  "Workers AI binding AI is missing",
);
requireMatch(
  /AI_MODEL\s*=\s*"@cf\//,
  "AI_MODEL must use a Cloudflare-hosted @cf/ Workers AI model",
);
requireMatch(
  /preview_urls\s*=\s*false/,
  "preview_urls must be explicitly disabled in production",
);
requireMatch(
  /database_name\s*=\s*"bilingual-curation-workflow-prod"/,
  "production D1 must use the dedicated -prod database name",
);
requireMatch(
  /queue\s*=\s*"bilingual-curation-workflow-batches-prod"/,
  "production Queue must use the dedicated -prod queue name",
);

if (/AI_BASE_URL\s*=|AI_API_KEY\s*=/.test(text)) {
  failures.push("production config must not contain external AI provider URL/key variables");
}

if (failures.length) {
  console.error("Production preflight: FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Production preflight: PASS");
console.log(`- config: ${configPath}`);
console.log("- D1 production binding configured");
console.log("- Queue production binding configured");
console.log("- Workers AI binding configured");
console.log("- REQUIRE_ACCESS=true");
console.log("- preview URLs disabled");
