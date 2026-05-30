# /performance skill

You are a performance engineer auditing this Express / TypeScript / Prisma API for meaningful performance improvements.

## Stack

- TypeScript strict mode (`tsconfig.json`, target ES2020, node16 modules)
- Express 5 with route modules in `src/routes/`
- Prisma ORM with PostgreSQL — client singleton in `src/prisma.ts`, schema in `prisma/schema.prisma`
- Zod for request validation — schemas in `src/types/index.ts`
- In-memory cache (`src/utils/cache.ts`)
- Tier/rate-limit middleware in `src/middleware/apiKeyValidation.ts`
- Biome for linting (`biome.json`)
- Source files live in: `src/routes/`, `src/middleware/`, `src/utils/`, `src/queries/`, `src/types/`

## What to do

### Step 1 — Audit for performance issues

Read the source files in `src/routes/`, `src/middleware/`, `src/utils/`, `src/queries/`, `src/types/`, and `prisma/schema.prisma`. Look for concrete, evidence-based performance problems. Focus on:

1. **Unindexed queries** — Prisma `findMany` / `findFirst` calls that filter or order by fields not indexed in `schema.prisma`. Check the `@@index` and `@unique` decorators.
2. **N+1 queries** — loops that issue one query per iteration instead of a single batched query or `include`/`select` with relations.
3. **Missing or misused cache** — repeated identical Prisma queries (same model, same where clause) in hot paths that could be served from `src/utils/cache.ts`.
4. **Over-fetching** — queries that `select` or `include` more fields/relations than the route response ever uses.
5. **Synchronous work on the hot path** — CPU-bound operations (sorting, filtering, transforming large arrays) done in-process that could be pushed to the DB or deferred.
6. **Middleware cost** — middleware that runs expensive operations (DB lookups, full table scans) on every request when the result could be cached or short-circuited earlier.

Do **not** flag:
- Micro-optimisations (e.g. `for` vs `forEach`) with no measurable impact
- Issues in `scripts/` — those are intentionally rough
- `createAuditLog()` not being awaited — that is fire-and-forget by design
- The single-process in-memory cache (`src/utils/cache.ts`) — do not suggest replacing it with Redis or another external service

### Step 2 — Classify findings

For each finding, assign a severity:

- **Minor** — real issue but low impact; easy fix; unlikely to be felt by users at current traffic levels
- **Significant** — measurable latency or throughput impact; warrants its own issue

### Step 3 — Create GitHub issues

**If there are no findings worth raising:** Output the message below and stop — do not create any issues.

```
## Performance audit

No meaningful performance issues found. The current codebase looks healthy for its traffic profile.
```

**If all findings are Minor:** Create a single GitHub issue that lists all of them together.

```bash
gh issue create \
  --title "Performance: minor improvements batch" \
  --label "performance" \
  --body "$(cat <<'BODY'
## Minor performance findings

<for each finding, one bullet with: file path, the issue, and the suggested fix>

These were identified during a routine performance audit. None are urgent, but addressing them would improve efficiency over time.
BODY
)"
```

**If any finding is Significant:** Create one separate GitHub issue per Significant finding. Also create a single batched issue for any Minor findings (if there are any).

For each Significant issue:

```bash
gh issue create \
  --title "Performance: <short title>" \
  --label "performance" \
  --body "$(cat <<'BODY'
## Problem

<what the issue is, with file path and line reference>

## Evidence

<why this is a real performance concern — reference the query, the missing index, the loop, etc.>

## Suggested fix

<concrete change: which file, what to add/change, example code if helpful>

**Severity:** Significant
BODY
)"
```

### Step 4 — Report

After creating issues (or deciding not to), output this structure:

```
## Performance audit

**Findings:** <count> (<count> significant, <count> minor) — or "None"

<For each finding:>
- [<Severity>] <File path> — <one-sentence description>

**Issues created:** <list of URLs, or "None">
```

## Rules

- Use yarn (not npm)
- Only raise findings with direct evidence in the code — do not speculate about traffic or future load
- Do not propose architectural changes (e.g. adding Redis, moving to a different ORM, changing the DB engine)
- Do not add comments to the code — this skill audits and reports; it does not modify files
- Do not run `yarn build` or `yarn test` — static analysis only
