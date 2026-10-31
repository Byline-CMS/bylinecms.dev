---
title: "Extraction contracts — implementation plan"
path: "extraction-contracts-plan"
summary: "Implement provisional extraction provider contracts, the verified source read and its companions, and a published provider conformance kit in four reviewable stages."
---

# Extraction contracts — implementation plan

Companions:

- [Specification](./2026-10-31-extraction-contracts-spec.md) — the contract this plan implements. Section numbers below refer to it.
- [Track roadmap](./2026-10-31-extraction-retrieval-track-roadmap.md) — Phase 4 tasks 4.1–4.4 map onto the stages here.

## Start here

This section is written so a new session can pick the work up without the
conversation that produced it.

### State at handover (2026-10-31)

1. Tony accepted the specification (revision 3, plus the same-day
   clarification adding `deploymentIdentifier` to the producer identity) and
   all eight §14 decisions. A final manual design review found no
   remaining blockers. **Next: Stage 1.** No implementation code exists yet.
2. Branch `feat/extraction-contracts-5`, based on `e3075ca9` (v6.12.0). The
   only changes are this plan, the specification and the roadmap.
3. **Review is manual for now.** Tony relays handoffs between this session
   and the reviewing session. Do not use the `/coordinate` mailbox unless
   Tony asks. (A handshake revision for run
   `2026-10-31-extraction-contracts` sits unanswered in the local `.coord/`
   mailbox; ignore it.) At each checkpoint, stop and give Tony a short
   handoff: scope (file list), what each spec rule maps to, the checks run
   with their results, and anything deferred.
4. The specification is self-contained. It reproduces the downstream
   prototype contract it replaces, so no file outside this repository is
   needed to implement it.

### Ground rules

1. Commit only when Tony asks, with conventional messages and
   `git commit -s`. The DCO `Signed-off-by` is the only permitted trailer.
2. Do not name the downstream installation or its domain anywhere in this
   repository; call it "a downstream research library".
3. No database is touched in this phase.
4. Do not post to GitHub (decision 8) until Tony says so.

### Repository facts the stages depend on

- **Root entry is browser-safe.** `packages/core/src/index.ts` and everything
  it imports must have no `node:` import; hash with WebCrypto `sha256Hex`
  (`packages/core/src/storage/content-hash.ts`). Server-only code goes in
  `packages/core/src/storage/stored-files-server.ts`, exported as
  `@byline/core/stored-files`. There is no automated guard for this today;
  Stage 1 adds one.
- **Tests** are `*.test.node.ts`, run with `pnpm --filter <pkg> test`
  (Vitest `--mode=node`). Packages that consume `@byline/core` read its
  `dist`, so run `pnpm --filter @byline/core build` before their tests.
- **Public exports** are audited against `knip.exports.baseline.json`:
  `pnpm knip:exports` reports new exports; `pnpm knip:exports:update`
  records deliberate ones. Run `pnpm knip` before handing off; it also runs
  on pre-push.
- **Storage conformance** lives in `packages/storage-conformance` (private)
  and runs from the `storage-local` and `storage-s3` test suites. The S3
  suite runs only when `BYLINE_S3_TEST_ENDPOINT` is set. Locally, match CI:

  ```sh
  docker run -d --name byline-rustfs -p 9100:9000 \
    -e RUSTFS_ACCESS_KEY=byline -e RUSTFS_SECRET_KEY=byline-test-secret \
    rustfs/rustfs:1.0.4
  BYLINE_S3_TEST_ENDPOINT=http://127.0.0.1:9100 \
  BYLINE_S3_TEST_ACCESS_KEY=byline BYLINE_S3_TEST_SECRET_KEY=byline-test-secret \
    pnpm --filter @byline/storage-s3 test
  ```

- **Lockstep set.** Publishable packages are listed in
  `.changeset/config.json` `fixed[0]`; `publish-packages.sh` reads it. The
  CLI dependency manifest (`packages/cli/src/manifest/deps.ts`) lists only
  packages an installed app needs, so the conformance kit is not added
  there. `packages/cli` `check:artifact` needs the CLI built first.
- **Docs** follow `CLAUDE.md` "Documentation Style" and the `writing-docs`
  skill; verify with `pnpm docs:check` and `git diff --check`.

## Decisions

| # | Question (spec §14) | Answer | Date |
|---|---|---|---|
| 1 | Placement: root types and pure helpers; server helpers in `@byline/core/stored-files` | Accepted | 2026-10-31 |
| 2 | Ship the §6 runtime helpers in this release | Accepted | 2026-10-31 |
| 3 | Verified body: memory below threshold, spool above | Accepted | 2026-10-31 |
| 4 | Publish `@byline/extraction-conformance` (lockstep 22 → 23) | Accepted | 2026-10-31 |
| 5 | Generated, committed PDF fixtures | Accepted | 2026-10-31 |
| 6 | Accept the prototype deviations as a set | Accepted | 2026-10-31 |
| 7 | Export lifecycle outcome types as provisional | Accepted | 2026-10-31 |
| 8 | Rewrite issue #5 and open the store/orchestration follow-up | Accepted; post only on Tony's go-ahead | 2026-10-31 |

## Stage 1 — Provider contract types and pure validators

Roadmap task 4.2. Spec §5, §7.

- [ ] `packages/core/src/@types/extraction-types.ts`: `ExtractionProvider`,
      `ExtractorCapabilities`, `ExtractionHints`, `ExtractionHintName`,
      `ExtractionInput`, `ExtractionResult`, `ExtractionMetadata`,
      `RoutingSignals`, `ExtractionFailureScope`, `PageMapV1`,
      `ExtractionArtifact`, `SourceVerificationEvidence`, the §6.1 outcome
      unions and the §7 lifecycle types. JSDoc carries the normative rules
      and the provisional marker on every exported symbol. Re-export from
      `@types/index.ts`.
- [ ] `packages/core/src/extraction/errors.ts`: `ExtractionProviderError`
      with the `code` brand; `isExtractionProviderError`,
      `isFileExtractionFailure`.
- [ ] `packages/core/src/extraction/page-map.ts`: `validatePageMap` with
      typed `PageMapIssue` codes, one per §5.8 rule.
- [ ] `packages/core/src/extraction/producer.ts`: canonical JSON,
      `producerConfigHash` over WebCrypto `sha256Hex` (identifier form
      validated), `ExtractionProducerIdentity` and `buildExtractionProducer`.
- [ ] `packages/core/src/extraction/artifact.ts`:
      `validateExtractionArtifact`.
- [ ] `packages/core/src/extraction/evidence.ts`:
      `isSourceVerificationEvidence` with the §6.4 rules, including the
      `readBasis` / `preconditionFallback` compatibility table and legacy
      records without `readBasis`.
- [ ] `packages/core/src/extraction/work.ts`: `decideExtractionWork` with the
      §5.10 version rules and `versionUnchecked`; `deploymentIdentifier` in
      `producerConfigHash`; a named successive-run regression test (no
      engine version, identifier `A` → extract, reuse; `B` → extract once,
      reuse) plus the resolved-but-unreported and mid-run sequences.
- [ ] `packages/core/src/extraction/outcomes.ts`: `exclusionState` (§7).
- [ ] Root barrel exports; `pnpm knip:exports` baseline updated only for
      deliberate public symbols.
- [ ] Unit tests (`*.test.node.ts`) for every validator rule, the work
      decision and version tables, the evidence compatibility table and
      malformed new fields, every `exclusionState` row (the failed-mark,
      successful-write regression as its own named test), the canonical hash
      and the cross-copy error guard (§10.2, last paragraph).
- [ ] Browser-safety guard (none exists today): a test that walks the
      import graph of the built root entry (`dist/index.js`) and fails on any
      `node:` specifier, so the new modules cannot regress it.

**Checkpoint 2.** Scope: `packages/core/src/@types/extraction-types.ts`,
`packages/core/src/extraction/**`, barrel changes. Review: fidelity to the
prototype and the downstream artifact field names, with each deviation
matching decision 6; validator rules exactly as §5.8; evidence rules as §6.4
with legacy records still valid; the version rule as §5.10 (no repeated
work for an unknown version or a result without a version, no copied
version, deployment identifier hashed and carried on the producer identity
consistently, both unknown-engine cases for `versionUnchecked`); `exclusionState` never
returns `excluded` after a failed eligibility update; no `node:` import in
the root graph; provisional markers. Checks: `pnpm --filter @byline/core
typecheck`, `pnpm --filter @byline/core test`, `pnpm exec biome check
packages/core`.

## Stage 2 — Verified source read

Roadmap task 4.2 (continued). Spec §6.

- [ ] `packages/core/src/storage/verified-read.ts`: `readVerifiedSource`,
      `probeVerifiedSource`, `VerifiedSourceBody` (memory or `0600` spool in
      `os.tmpdir()`, deleted on every failure path and by `dispose`).
      Hashing reuses the streaming SHA-256 from `hashStream`; extract a
      shared helper rather than duplicating it.
- [ ] Export from `stored-files-server.ts`.
- [ ] Unit tests over a scripted fake `IStorageProvider`: unrecognised
      precondition reason, precondition on both reads (two calls exactly),
      mid-body error, abort, spool cleanup, `download` never called for
      `missing-hash`, `head` never called without evidence.
- [ ] `@byline/storage-conformance`: the §10.2 cases that real providers
      can exercise (unchanged, different bytes, identical bytes rewritten,
      unsupported kind, deleted, large body spooled, probe matrix, provider
      without `head`). Run in `storage-local` and `storage-s3`.

**Checkpoint 3.** Scope: `packages/core/src/storage/verified-read.ts`,
`stored-files-server.ts`, tests, `packages/storage-conformance/src/**`.
Review: every rule in §6.2 traced to a test; the evidence validator is
always the read's own; never more than two reads; no body exposed on any
non-`verified` path; spool files removed on every path; the saved envelope
never written. Checks: core tests; `pnpm --filter @byline/storage-local
test`; `pnpm --filter @byline/storage-s3 test` with RustFS (announce in the
mailbox); `pnpm typecheck`.

## Stage 3 — Provider conformance kit

Roadmap task 4.3. Spec §10.1.

- [ ] `packages/extraction-conformance` (`@byline/extraction-conformance`):
      package manifest following `storage-conformance`, but publishable per
      decision 4 (`private` removed, `files`, `exports`, `vitest` as a peer
      dependency, MPL header, README). Add to `.changeset/config.json`
      `fixed[0]`. Not added to the CLI dependency manifest (see "Repository
      facts").
- [ ] `scripts/generate-fixtures.mjs`: writes a three-page PDF with one
      sentinel per page (`BYLINE-SENTINEL-PAGE-1` …) and a truncated copy,
      using hand-written PDF syntax and no dependencies. Commit the outputs
      under `fixtures/`; a test asserts the committed files match the
      generator's output.
- [ ] `defineExtractionProviderConformance(hooks)` with cases 1–9.
- [ ] Self-tests: an honest fake (returns canned results for the fixtures,
      with a correct page map) passes; dishonest fakes fail the intended
      case — markdown emitted with `markdown: false`, a page map with a
      shifted page, an untyped error for the truncated file, an
      infrastructure error typed as `file`, an abort that resolves, a
      `resolveVersion` that disagrees with the result's `providerVersion`.
- [ ] `check:artifact` and `publish-packages.sh` dry run include the new
      package (build the CLI first, as before).

**Checkpoint 4.** Scope: `packages/extraction-conformance/**`,
`.changeset/config.json`, any CLI manifest change. Review: every §10.1 case
present and proven to fail by a dishonest fake; sentinel case is the only
provenance claim; package publishable and lockstep-correct. Checks:
package tests; `pnpm knip`; `./publish-packages.sh --dry-run` for the pack
step only.

## Stage 4 — Documentation and release preparation

Roadmap task 4.4. Spec §13, §15, §16.

- [ ] Rewrite `docs/06-search/07-attachment-extraction.md` as concepts and
      lifecycle (keep `path`); add `docs/06-search/10-extraction-provider-contract.md`;
      extend the Content identity section of
      `docs/04-collections/06-file-media-uploads.md`; update
      `docs/06-search/index.md`. Use `/document`; text diagrams, no Mermaid.
- [ ] README for `@byline/extraction-conformance`.
- [ ] Update `CLAUDE.md` (package table and the Search section's planned
      list) and the roadmap.
- [ ] Changeset (minor) naming the provisional status.
- [ ] Draft the issue #5 rewrite and the follow-up issue; post only when
      Tony says.
- [ ] Downstream adoption note (spec §16), with no downstream names in the
      repository.

**Checkpoint 5.** Scope: `docs/**`, `CLAUDE.md`, the roadmap, the changeset,
the README. Review: docs match shipped code; guarantees not yet implemented
are fenced as not shipped; host policies presented as an example only.
Checks: `pnpm docs:check`, `git diff --check`, full `pnpm typecheck`, `pnpm
test`, `pnpm exec biome check .`.

## Risks

- **Page map v1 changes after real-corpus evidence.** Mitigation: provisional
  marker, `version` field, and no stable claim until sentinel results exist.
- **Spool files leak on crash.** A process crash between spooling and
  dispose leaves a `0600` file in the temporary directory. Mitigation: a
  recognisable prefix so operators can clean it; documented.
- **Published kit couples to Vitest.** Mitigation: Vitest as a peer
  dependency; the case functions are plain async functions the
  `define…` wrapper registers, so a later non-Vitest runner is possible.
- **Lockstep growth.** A 23rd package increases release surface.
  Mitigation: decision 4 can keep it private and vendor-copy instead.
- **Lifecycle types drift from the eventual store.** Mitigation: provisional
  marker; the store release may revise them under a minor with a changelog
  note.
