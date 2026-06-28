# /security skill

You are running an incremental security improvement session for this Express / TypeScript / Prisma API.

## Stack

- TypeScript strict mode (`tsconfig.json`, target ES2020, node16 modules)
- Express 5 with route modules in `src/routes/`
- Prisma ORM with PostgreSQL — client singleton in `src/prisma.ts`
- Zod for request validation — schemas in `src/types/index.ts`
- Biome for linting (`biome.json`, scoped to `src/`)
- Vitest for testing
- Source files live in: `src/routes/`, `src/middleware/`, `src/utils/`, `src/queries/`, `src/types/`

## What to do each invocation

### Step 1 — Scan for vulnerabilities

Read the source files in `src/routes/`, `src/middleware/`, `src/utils/`, `src/queries/`, and `src/types/`. Look for **concrete, exploitable** security issues in these categories:

1. **Injection** — SQL injection via unsanitized input passed to raw queries, command injection, NoSQL injection, path traversal in file operations
2. **Auth & authorization** — authentication bypass logic, missing auth middleware on protected routes, privilege escalation paths, JWT vulnerabilities, routes that expose another user's data
3. **Data exposure** — PII or secrets written to logs, API responses leaking internal fields (e.g. hashed passwords, internal IDs), debug information returned to callers
4. **Input validation gaps** — missing Zod validation on user-supplied input that reaches the database or filesystem, type coercion surprises, unvalidated pagination or filter parameters
5. **Crypto & secrets** — hardcoded credentials, weak or missing token generation, predictable IDs used for access control

Only flag issues you are **>80% confident** are real, exploitable vulnerabilities — not theoretical best-practice gaps. Do not flag: rate limiting, DoS, regex DOS, resource exhaustion, lack of audit logs, client-side validation, or issues in test files.

### Step 2 — Triage severity

Classify each finding:

- **HIGH** — directly exploitable: RCE, auth bypass, another user's data accessible, secrets exposed
- **MEDIUM** — requires specific conditions but meaningful impact: data leakage under certain inputs, privilege escalation with user interaction
- **LOW** — defense-in-depth, minor hardening

Discard anything you cannot assign at least MEDIUM with high confidence.

### Step 3 — Create GitHub issues

For each HIGH finding, create a **separate** GitHub issue. For all MEDIUM and LOW findings, group them into **one** GitHub issue. Use the following format for each issue:

**HIGH issue title:** `Security: <short description> (<file>)`

**HIGH issue body:**
```
## Vulnerability

**Severity:** HIGH
**File:** <path:line>
**Category:** <e.g. auth_bypass, data_exposure, injection>

## Description

<One paragraph explaining what the vulnerability is and why it is exploitable.>

## Exploit scenario

<Concrete steps an attacker would take to exploit this.>

## Recommended fix

<What should be changed and why.>
```

**Grouped MEDIUM/LOW issue title:** `Security: minor findings (<date>)`

**Grouped MEDIUM/LOW issue body:**
```
## Minor security findings

<For each finding:>

### <short description> — <file:line>

**Severity:** MEDIUM / LOW
**Category:** <category>
**Issue:** <one sentence>
**Fix:** <what to change>

---
```

Create issues using: `gh issue create --title "..." --body "..."`

If there are no findings above your confidence threshold, output a short summary stating no actionable issues were found and do not create any issues.

### Step 4 — Report

Output exactly this structure:

```
## Security scan

**Findings:** <count of HIGH> high, <count of MEDIUM> medium, <count of LOW> low
**Issues created:** <list of URLs, or "none">
**Next area to review:** <the next file or category worth scanning>
```

## Known project patterns

- **Auth helpers:** `requireAuth()` in `src/utils/authCheck.ts` — all protected routes must use this; routes missing it are a HIGH finding
- **Zod validation:** request bodies and query params should be validated with Zod schemas from `src/types/index.ts` before reaching Prisma
- **Prisma raw queries:** `prisma.$queryRaw` and `prisma.$executeRaw` require tagged-template syntax (`Prisma.sql` or `sql\`...\``) — string interpolation into raw queries is SQL injection
- **Error responses:** standard shape is `{ error: string }` — stack traces or internal details must not be returned to callers
- **Audit logging:** `createAuditLog()` in `src/utils/auditLog.ts` is fire-and-forget — do not flag its lack of `await`
- **Test files:** `*.test.ts` are excluded from security findings

## Rules

- Use yarn (not npm)
- Do not fix vulnerabilities in this session — only audit and create issues
- Do not create issues for theoretical or low-confidence findings
- Do not create duplicate issues — run `gh issue list --label security` first to check for existing ones
- Apply the label `security` when creating issues: add `--label security` to the `gh issue create` command (create the label first if it doesn't exist: `gh label create security --color e11d48`)
