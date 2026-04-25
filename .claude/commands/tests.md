# /tests skill

When invoked, make an incremental improvement to test coverage, then run the tests.

## Context

- Test runner: vitest (already configured in `vitest.config.ts`)
- Test files live in `src/**/*.test.ts`
- Coverage: `yarn test:coverage`
- Mock pattern: `vi.mock("../prisma", ...)` — prisma is always mocked, never real DB
- HTTP tests use supertest with an in-process express app

## Steps

1. Run `yarn test:coverage` and read the coverage table.
2. Identify the file with the lowest branch or statement coverage that doesn't yet have full coverage.
3. Read that file and its existing `.test.ts` counterpart (if any).
4. Add the **minimum tests needed to cover the most important uncovered branches** — don't rewrite existing tests, just add new `it(...)` blocks.
5. Re-run `yarn test:coverage` to confirm coverage improved and all tests pass.
6. Report: what you added and the before/after coverage numbers for that file.

## Current known gaps (as of 2026-04-20, 93.6% overall)

- `src/utils/rateLimiting.ts` — `batchCheckRateLimits` function (lines 133–205) is 0% covered. The existing test file only covers `checkRateLimit` and `recordApiUsage`. Add tests for `batchCheckRateLimits` to `src/utils/rateLimiting.test.ts`. Mock pattern: the file already mocks `@prisma/client` — you'll need to also mock `apiKeyUsage.groupBy` and `apiKey.updateMany` in that mock.
- `src/utils/cache.ts` — TTL expiry path (lines 13–17) and `clearCache(key)` single-key variant (line 28) are uncovered. Tests belong in `src/utils/rateLimiting.test.ts`... actually a dedicated `src/utils/cache.test.ts` if it doesn't exist.

## Rules

- Use yarn (not npm)
- Never connect to a real database — always mock prisma
- Don't add test helpers or shared fixtures — keep each test file self-contained
- Don't modify existing tests
