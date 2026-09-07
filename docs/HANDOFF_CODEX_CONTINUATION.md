# Codex Continuation Handoff

## 1. Repository and current branch

Repository:

`Felix8686/bilingual-curation-workflow`

Current development branch:

`chore/production-readiness-v1`

Current PR:

`#8 Production Readiness v1: Access guard + Workers AI`

Current expected branch HEAD before this handoff document was added:

`728af013caec53546a99d6de5f727583f1725b95`

The commit that adds this handoff document becomes the new branch HEAD. Do not assume the old SHA is still the current branch HEAD; verify with Git before doing any work.

Stable production-candidate baseline on `main`:

`00601a909e73acf29a7c22db1d8b90dc6be6203f`

Do not modify or merge into `main` unless the user explicitly authorizes it.

---

## 2. Project goal

This project is a Cloudflare-first bilingual content curation workflow intended to help prepare English/Chinese reading posts for manual Douyin publishing.

The intended workflow is:

`theme -> source discovery -> AI filtering/translation -> immutable source-English restoration -> bilingual publication draft -> D1 persistence -> Queue async execution -> Review Console -> manual review -> manual Douyin publishing`

Important product boundary:

- The system must not automatically publish to Douyin.
- No RPA publishing is part of the current scope.
- AI must not rewrite the supplied English source text.
- Existing human-authored works remain independent sections; AI must not synthesize several works into a new article.

---

## 3. Accepted and merged phases

All of the following are already merged into `main` and have been physically validated by Hermes:

1. MVP v1
2. Source Pipeline v1
3. Selection + Translation v1
4. End-to-End Workflow v1
5. Batch Pipeline v1
6. Queue Pipeline v1
7. Review Console v1

The final post-merge `main` full regression was PASS at:

`00601a909e73acf29a7c22db1d8b90dc6be6203f`

Validated capabilities on that baseline include:

- 7 test files / 25 tests PASS
- Project Gutenberg / Gutendex source discovery
- Wikiquote source discovery
- OpenAI-compatible mock provider path
- source-English anti-rewrite protection
- full `/api/workflows/generate` flow
- local D1 migrations 0001-0003
- batch persistence and restart recovery
- Queue async execution and duplicate-delivery idempotency
- retry/final-failure behavior
- manual `/run` fallback
- Review Console browser rendering
- review status persistence
- review updates do not alter `result_json`, `publicationDraft`, or source English
- Review Console inline JavaScript syntax regression test

Do not reopen or redesign these layers without concrete evidence of a regression.

---

## 4. Current phase: Production Readiness v1

The current branch adds production-safety and production-provider preparation only. It has NOT yet been authorized for production deployment.

Current PR #8 adds:

### Workers AI native binding

Production can use:

- `AI_MODEL`
- `env.AI.run(...)`

without storing a Cloudflare API token inside the Worker.

The existing OpenAI-compatible path remains available for local mock testing and future fallback providers.

Production candidate model currently configured:

`@cf/qwen/qwen3-30b-a3b-fp8`

Do not change the model casually. If changing it, verify current Cloudflare availability, pricing, plan restrictions and API behavior first.

### Access fail-closed protection

Production configuration uses:

`REQUIRE_ACCESS=true`

When this flag is enabled and Cloudflare Access runtime context is absent, HTTP requests must fail closed with HTTP 403.

This is an application-level safety fuse in addition to the Cloudflare Access product configuration.

### Production configuration isolation

Production configuration lives in:

`wrangler.production.toml`

Expected production resource names are isolated from development/local resources, including `-prod` names for D1 and Queue.

Preview URLs are disabled for production.

### Deployment preflight

Script:

`scripts/production-preflight.mjs`

Package command:

`npm run prod:preflight`

The checked-in production D1 ID is deliberately a placeholder:

`REPLACE_WITH_PRODUCTION_D1_ID`

Therefore the real repository configuration must currently make `npm run prod:preflight` FAIL.

This failure is intentional and is a deployment safety gate.

A temporary copied config with a syntactically valid UUID should make the same preflight PASS, proving the gate is capable of both blocking and releasing deployment.

---

## 5. Existing verification plan

Before writing new code, read:

`docs/HANDOFF_PRODUCTION_READINESS_V1.md`

That file is the authoritative verification checklist for the current phase.

Expected checks include:

- typecheck/test regression
- Workers AI binding mock behavior
- OpenAI-compatible mock regression
- original-English anti-rewrite behavior
- Access fail-closed behavior
- production config inspection
- real checked-in production config preflight must FAIL because of placeholder D1 ID
- temporary valid UUID config preflight must PASS
- local `/api/workflows/generate` regression using mock AI
- clean git state
- no remote Cloudflare mutations

If a defect is found in the current branch, fix it only on `chore/production-readiness-v1`, update tests and handoff documentation as necessary, and leave `main` untouched.

---

## 6. Immediate takeover objective for Codex

Codex should take over from the current repository state and do the following in order:

1. Verify the actual current HEAD of `chore/production-readiness-v1`.
2. Read this document, `docs/HANDOFF_PRODUCTION_READINESS_V1.md`, `wrangler.production.toml`, `src/ai.ts`, `src/index.ts`, `scripts/production-preflight.mjs`, and the production-related tests.
3. Review PR #8 changes against `main` for correctness, safety and accidental regressions.
4. Run the local validation that is feasible in the Codex environment. If environment limitations prevent a meaningful Cloudflare/Miniflare check, do not fake PASS; prepare a precise Hermes verification instruction instead.
5. If defects are found, fix them on `chore/production-readiness-v1`, add regression tests, and update this handoff plus `docs/HANDOFF_PRODUCTION_READINESS_V1.md` when needed.
6. Do not merge PR #8 unless the user explicitly authorizes merge.
7. Do not create or modify production Cloudflare resources unless the user explicitly authorizes the provisioning/deployment step.
8. Once Production Readiness v1 is genuinely PASS, prepare the next phase as a separate branch from the accepted head rather than modifying `main` directly.

---

## 7. Next phase after Production Readiness v1 PASS

The likely next phase is Cloudflare production resource provisioning and first protected deployment.

Expected sequence:

1. Create real production D1 database.
2. Put the actual D1 UUID into the production config.
3. Create the production Queue.
4. Confirm Workers AI binding/model availability for the account.
5. Configure Cloudflare Access protection before exposing the Review Console/API.
6. Apply migrations 0001-0003 to the production D1.
7. Run `npm run prod:preflight` and require PASS.
8. Deploy the production Worker.
9. Verify unauthenticated access is denied.
10. Verify authenticated Access session can load the Review Console.
11. Run a minimal real cloud E2E using a very small batch.
12. Verify Workers AI translation/filtering quality and source-English immutability.
13. Verify D1 persistence, Queue processing and Review Console review-state changes.
14. Stop if any security boundary is not behaving exactly as expected.

Do not add Cron yet. First establish a secure, stable, manually triggered production deployment.

---

## 8. Strict constraints

Unless the user explicitly changes them:

- GitHub is the single project source of truth.
- Development occurs on an independent branch.
- Do not directly modify `main`.
- Do not merge without explicit user authorization.
- Do not add automatic Douyin publishing or RPA.
- Do not rewrite original English source content.
- Do not silently relax rights/review warnings.
- Do not expose the Review Console publicly without Access protection.
- Do not bypass the production preflight safety gate.
- Do not store Cloudflare API tokens in committed files.
- Do not claim PASS when a required real-world verification was not actually performed.
- Do not introduce Cron until secure production deployment and manually triggered cloud E2E are accepted.

---

## 9. Evidence discipline

Use these evidence levels explicitly:

- `implemented`: code exists but has not been executed in the target environment.
- `unit-tested`: automated local tests passed.
- `locally-validated`: Worker/Miniflare/local D1/Queue path was actually exercised.
- `cloud-validated`: actual Cloudflare production/staging resources were exercised.
- `production-accepted`: all required production acceptance criteria passed.

Never collapse these levels into one generic PASS.

---

## 10. Required Codex handback

When Codex finishes its current takeover task, provide the user with:

1. Overall status: PASS / PARTIAL / FAIL.
2. Current branch and exact HEAD.
3. Files changed, if any.
4. Tests/checks actually executed and their results.
5. Any checks that could not be executed and why.
6. Confirmation that `main` was not modified.
7. Confirmation that PR #8 was not merged unless explicitly authorized.
8. Confirmation that no production Cloudflare resource was created/modified unless explicitly authorized.
9. Exact next recommended action.
10. If Hermes is needed, one complete copyable Hermes instruction and the exact expected HEAD to verify.

This handoff is intended to let Codex continue the project without requiring the user to restate prior architecture or safety decisions.
