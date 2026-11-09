# Storage save benchmark — single-locale save, scale 10,000

Measures the cost the localized-toggle work (issue #106) adds to every single-locale save: one whole-version `(field_path, locale)` query that classifies localization mismatches.

- Run at: 2026-11-09
- Platform: darwin arm64 / Apple M5 Max / 128 GB RAM (not the M1 Pro used for the read sweeps, so compare before and after here, not against the cold-read results)
- Node: v26.13.0
- Database: local Dockerised Postgres 18.4, `byline_dev` (the database in `packages/db-postgres/.env`); the harness only touches the `bench-*` collections
- Scenario: `updateDocument` from `@byline/core/services`, `locale: 'en'`, super-admin context, one changed text field (`summary`), against a seeded `bench-articles` document. Harness: `benchmarks/storage/harness/run-save-bench.ts` (`pnpm bench:save --scale 10000`)
- Method: 10 warmup iterations (discarded), then 50 measured; median and p95 as in `run-bench.ts`. Iteration N saves a different document (the 60 most recent), so each save lands on a document with one prior version and version count cannot drift the timing. The revision read and the document read that builds the payload happen before the timer starts.
- Procedure: re-seeded (`seed.ts --scale 10000`) immediately before every measured run; 3 runs per checkout; identical harness file in both checkouts.
- Before: `359a07a9910cdffe363ae61ae51d76cd631a649d` (parent of the branch's first commit, in a git worktree)
- After: `1853d0cb` (HEAD of `fix/localized-toggle-106`, Tasks 1-6)

| Run | Before median (ms) | Before p95 | After median (ms) | After p95 |
|---|---:|---:|---:|---:|
| 1 | 9.78 | 10.49 | 9.87 | 10.53 |
| 2 | 9.61 | 10.40 | 9.93 | 10.65 |
| 3 | 9.52 | 10.16 | 9.95 | 10.48 |
| Median of runs | 9.61 | 10.40 | 9.93 | 10.53 |

Delta in median save time: +0.32 ms (+3.3%) using the median of runs; +0.09 ms (+0.9%) for run 1 alone, +0.43 ms (+4.5%) for run 3. This is under the 10% threshold.
