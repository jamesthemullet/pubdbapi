# /quality skill

You are running an incremental code quality improvement session for this Express / TypeScript / Prisma API.

## Stack

- TypeScript strict mode (`tsconfig.json`, target ES2020, node16 modules)
- Express 5 with route modules in `src/routes/`
- Prisma ORM with PostgreSQL — client singleton in `src/prisma.ts`
- Zod for request validation — schemas in `src/types/index.ts`
- Biome for linting (`biome.json`, scoped to `src/`)
- Vitest for testing
- Source files live in: `src/routes/`, `src/middleware/`, `src/utils/`, `src/queries/`, `src/types/`

## What to do each invocation

### Step 1 — Pick a category

Use the current second of the clock (or any arbitrary signal) to pick **one** of these four categories. Vary the selection — do not always pick the same one:

1. **Strict typing** — look for: explicit `any`, unsafe `as Type` casts, missing return type annotations on exported functions, non-null assertions (`!`) that could be replaced with proper guards, parameters typed as `object` or `{}`
2. **Code duplication** — look for: repeated error-response patterns across routes, identical Prisma query shapes copy-pasted across files, values inlined 3+ times that should be a named constant, duplicated Zod schema fields that should be shared
3. **Bad patterns** — look for: `console.log` left in production code (not test files), unhandled promise rejections in route handlers, fire-and-forget `async` calls that swallow errors silently, magic numbers/strings (HTTP status codes excepted when used correctly), missing `await` on async utility calls
4. **Dead code** — look for: exported functions or types not imported anywhere in the project, commented-out code blocks left in files, unused variables or imports (Biome will often surface these — check `yarn lint` output too)

### Step 2 — Find the best candidate

Read the relevant source files in `src/routes/`, `src/middleware/`, `src/utils/`, `src/queries/`, and `src/types/`. Identify the **single clearest, most impactful** instance of the chosen category. Prefer issues that:
- Are in frequently-called files (routes and middleware over one-off scripts)
- Have an unambiguous fix
- Won't require changes across many files

Do **not** flag items in `.test.ts` files unless the issue also affects the source file being tested.

### Step 3 — Fix it

Make the fix. Keep scope tight — one issue, one or two files. Do not refactor beyond what is needed to address the specific finding. Run `yarn lint` after editing to confirm no new lint errors are introduced.

### Step 4 — Report

Output exactly this structure:

```
## Quality improvement

**Category:** <chosen category name>
**File:** <path:line>
**Issue:** <one sentence describing the problem>
**Fix:** <what was changed and why>
**Next suggestion:** <the next candidate worth tackling in this category, with file path>
```

## Known project patterns

- **Auth helpers:** `requireAuth()` in `src/utils/authCheck.ts` provides type-narrowing for authenticated routes — use it instead of manual `req.user` checks
- **Error responses:** standard shape is `{ error: string }` (single) or `{ errors: object }` (Zod flatten) — do not deviate
- **Prisma transactions:** multi-table writes should use `prisma.$transaction()` — standalone writes in a sequence without a transaction are a smell
- **Audit logging:** `createAuditLog()` in `src/utils/auditLog.ts` is fire-and-forget by design — do not flag its lack of `await` as a bug
- **In-memory cache:** `src/utils/cache.ts` is single-process only — do not suggest replacing it unless the task is specifically about caching
- **Biome ignore list:** anything in `biome.json` `ignore` — do not flag as a quality issue
- **Test files:** `*.test.ts` files are excluded from production quality findings (dead-code findings in test files are noise)
- **`scripts/`**: import and seed scripts are intentionally rough — skip them

## Rules

- Use yarn (not npm)
- Do not rewrite tests to cover a quality fix — make the smallest source change that addresses the issue
- Do not add comments explaining what code does — only add a comment if the *why* is non-obvious
