---
title: "Password session verification evidence"
path: "password-session-verification-evidence"
summary: "Record local verification query costs and distinguish executable measurements from withdrawn browser protocol experiments."
---

# Password session verification evidence

Companions:

- [Implementation plan](../../2026-09-08-password-sign-in-security-plan.md) records implementation and acceptance status.
- [Security specification](../../2026-09-08-password-sign-in-security-spec.md) defines the selected JWT protocol.

## Local query benchmark

The native provider now verifies account generation, login validity, and permissions. This measurement compares account-plus-permissions verification against the new provider, including JWT signature verification in both paths. It ran locally on 2026-09-08 against isolated PostgreSQL and MySQL test databases, with 1,000 and 10,000 login rows and approximately half the rows revoked. Each measurement alternated 200 samples of each path after ten warm-up iterations.

| Adapter | Login rows | Baseline p50 / p95 / p99 (ms) | With login p50 / p95 / p99 (ms) |
| --- | ---: | --- | --- |
| PostgreSQL | 1,000 | 0.813 / 1.014 / 1.207 | 1.148 / 1.440 / 2.134 |
| PostgreSQL | 10,000 | 0.614 / 0.735 / 0.828 | 0.877 / 1.038 / 1.068 |
| MySQL | 1,000 | 0.734 / 1.094 / 1.237 | 1.051 / 1.418 / 1.739 |
| MySQL | 10,000 | 0.649 / 0.792 / 0.974 | 0.917 / 1.137 / 1.500 |

The added p95 cost was approximately 0.3–0.4 ms. PostgreSQL used the login primary-key index; MySQL used a `const` lookup on `PRIMARY`. These are warm, sequential local measurements, not a production load test or a concurrency capacity claim. No numeric regression budget was agreed. Tony confirmed that editorial populations will be small, asked to retain these measurements for a possible future user domain, and instructed that further benchmark optimization should not hold up this work.

`verification-benchmark-results.json` preserves the summaries and query plans. The adjacent `verification-benchmark.mjs` script reads package-local ignored test configuration, refuses database names without an `_test` suffix, and deletes its fixture account in a `finally` block. Build the workspace first, then run from the repository root:

```sh
node specs/experiments/password-session-ordering/verification-benchmark.mjs /tmp/byline-session-benchmark.json
```

This local script uses PostgreSQL `.env.test.local` and MySQL `.env.test`; adapt those ignored configuration paths for another machine. It does not read development credentials or benchmark development accounts.

## Inactive protocol models

`protocol-model.mjs` and `client-intent-model.mjs` are exploratory models from the earlier design discussion. The browser binding and IndexedDB marker proposals they explore were not selected. They are not runtime dependencies, browser tests, or acceptance evidence for the implemented coordination protocol.
