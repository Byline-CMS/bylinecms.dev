---
title: "Stale document write protection Task 11 evidence"
path: "stale-document-write-protection-task11"
summary: "Map the specification acceptance criteria and record the final regression and R5 review boundary."
---

# Stale document write protection Task 11 evidence

Companions:

- [Implementation plan](./2026-09-05-stale-document-write-protection-plan.md)
- [Approved specification](./2026-09-05-stale-document-write-protection-spec.md)
- [Task 10 evidence](./2026-09-05-stale-document-write-protection-task10.md)

Date: 2026-09-06. Tasks 10–11 are prepared for R5 review. R0 through
R4 passed independent review. This record reports repository release readiness
separately from authorization to publish packages or execute a production
cutover.

The R5 candidate consists of the reviewed implementation at `f6575b25`, the
reviewed Drizzle squash at `c663bf12`, the R4 record at `90bbe062`, and the
current Tasks 10–11 working-tree diff from `90bbe062`.

## Acceptance matrix

The provider-independent entries below execute through both PostgreSQL and
MySQL from `tests/conformance.integration.test.ts`. Test names are quoted when
one focused case is decisive; a named suite covers its operation matrix.

| Criterion | Concrete evidence | Coverage |
| --- | --- | --- |
| 1. A stale editor cannot apply any covered mutation | `guarded lifecycle saves > Task 6 remaining lifecycle guards` covers status, unpublish, delete, locale deletion, restore, copy and duplicate; the combined-save, schedule and structural cases cover the remaining families. R4 independently reproduced a losing editor Save and Publish in two tabs. | Both providers, SDK/host/admin |
| 2. Exactly one simultaneous same-revision save succeeds | `document revision primitives > serializes two physical writers when the first commits` and `...when the first rolls back` use separate physical connections and explicit barriers. | Both providers |
| 3. Metadata/status invalidates old content observations | `metadata-only Save with explicit en/fr locale needs no version parent`, `checks stale metadata no-ops and suspends schedules for changed metadata`, and `validates stale no-ops and retains the revision for current status/unpublish no-ops`. | Both providers |
| 4. Stale combined Save is fully atomic | `returns creation revision 1 and advances a combined save exactly once`; the `rolls back all document state when path/content/audit/schedule/revision fails` cases; and stale replacement cases assert no version, metadata, audit, schedule or revision leak. | Both providers |
| 5. Stale publish/replacement cannot publish newer content | `rechecks after status preparation and never publishes a newer winner`, `rejects a losing prepared replacement without replaying hooks or attaching its upload`, and SDK `rejects a stale full replacement and leaves the winning data intact`. | Both providers and SDK |
| 6. Missing/runtime-invalid preconditions fail closed | SDK `revision-preconditions.test.node.ts` exercises every collection/singleton method; host `revision-input.test.node.ts` rejects missing, null, string, zero, negative, fractional and unsafe inputs before writing; stale no-op coverage confirms equality is checked first. | SDK and host |
| 7. Locale/field edits still conflict and freshness is not manufactured | Provider revision/save races and `rejects a duplicate after source preparation if another editor wins`; SDK integration rejects an older full replacement. The direct-command audit found no production helper that fetches a new revision to replay an older payload. | Both providers and SDK |
| 8. Editable reads are coherent and ordinary reads cannot authorize writes | `editable snapshots` covers content, status, metadata, tree, schedules and empty singleton races; client `explicit editable client reads` proves published/historical reads remain token-free and rejects status/version selectors on editable reads. | Both providers and SDK |
| 9. Empty singleton first-save race has one winner | `singleton lifecycle > rejects a competing first save under the registered-slot lock` plus editable snapshot empty-slot coherence and singleton lifecycle unit precondition coverage. | Both providers and core |
| 10. Structural guards, revisions and rollback are preserved | `repairs flat sibling keys atomically and advances each changed document once`, `rejects a stale tree no-op and validates every derived target before changing anything`, `rolls back all structural effects, suspension, and earlier increments on a late derived failure`, and the coordinated opposite-direction move race. | Both providers |
| 11. Scheduled publication retains authorization semantics | `arms and reconfirms the resulting revision...`, `leaves a replaced worker claim untouched`, the three editor-versus-worker preparation races, and `publishes only the authorized revision and advances it once while clearing the claim`. | Both providers |
| 12. Errors survive transport and the editor retains/blocks/reloads explicitly | `document-mutation-transport.test.node.ts` executes 11 Start HTTP/Seroval cases. `document-mutation-state.test.tsx` and `persistent document concurrency recovery` cover retained fields, synchronous blocking, focused alerts and explicit discard. R4 independently verified two-tab behavior. | Host, admin and browser review |
| 13. Successful receipts form a new baseline; committed hooks stay distinct | `reports the committed revision when an after-hook fails`, metadata/media committed receipt cases, Start transport `keeps committed hook warnings separate and preserves their committed revision`, and editor observation ownership `keeps committed hook failures distinct and advances only to the committed revision`. | Both providers, host and admin |
| 14. Migration, startup, maintenance and old-client boundaries are covered | Each provider's `document revision native upgrade` suite covers occupied upgrades, reruns/resume, incompatible schema, safe range and fresh squashed baseline. CLI database installation covers empty databases. Core capability tests reject old adapters. Host/SDK omission tests reject old callers. The PostgreSQL/MySQL runbooks separately own downstream credential/session fencing and copied-source audits. | Automated plus explicit operator checks |
| 15. Schedule invalidation and worker mismatch are safe | Metadata suspension, arming/reconfirmation, `suspends an authorization mismatch without adopting the new revision`, upgrade fixtures moving legacy schedules to `upgrade_invalidated`, and schema/startup checks. | Both providers and native upgrades |
| 16. Re-anchor advances; repeated normalization does not | PostgreSQL `guarded maintenance validates dry runs and no-ops, then advances once...`, explicit stale batch targets and rollback cases; `leaves already-stamped source locales and document revisions unchanged on repeated backfill` pins the normalization exception. | PostgreSQL maintenance |
| 17. Safe integer contract survives every layer | `document revision primitives > reads the safe numeric boundary exactly and rejects overflow without writing`, schema constraints/startup validation, core `document-revision.test.node.ts`, host invalid-input cases, and Start transport `round-trips safe integer observations and receipts as numbers`. | Schema, both drivers, core, SDK/host |
| 18. Error variants remain distinct | Core `document stale error contract`, including parent normalization; low-level parent conformance; singleton empty-slot race; revision validation; lock-conflict tests; and Start transport `does not classify unrelated or malformed conflicts by message`. | Core, providers and host |
| 19. Path conflict and upload attachment remain atomic | `detects a live path collision before inserting content`, path rollback cases, stale-first combined-save coverage, and `rejects a losing prepared replacement without replaying hooks or attaching its upload`. | Both providers |
| 20. Structural suspension is reported without disclosure or false failure | `advances promoted children and suspends their schedules...`, `does not disclose derived targets or schedule suspension to a write-only editor`, structural receipt Start transport, editor receipt adoption, and admin `shows structural schedule suspension separately without marking the form stale or clearing edits`. | Both providers, host and admin |

## Direct-command and bypass audit

The final production-source search covered `apps`, CLI templates, client, host
and admin for `db.commands.documents.*` and collection commands. Its only hits
were application and template seed files calling `createDocumentVersion` to
create fixture content. Lifecycle production code contains the expected private
raw-command implementations behind the guarded services. No new SDK, host,
admin, script or maintenance path bypasses revision comparison, and there is no
unconditional-write or fetch-latest-and-retry switch.

## Concurrency repetition boundary

R4's independent checkpoint evidence already contains ten full integration
suite passes per provider and ten focused 136-case concurrency passes per
provider. The reviewing agent separately repeated the series successfully.
Task 11 added ten more clean PostgreSQL focused runs and began a MySQL series;
the user stopped it after three clean runs because the unchanged race surface
had already received repeated evidence in both sessions. Each completed Task
11 run executed 136 cases and skipped the other 196 conformance cases by name;
the unfiltered final suites cover the full set. Repetition supplements the
explicit connection/barrier mechanisms and does not prove absence of races.

## Final verification

An unrun command is not a pass. The retained Playwright files are no longer a
project release gate; Task 9's in-app-browser walkthrough and independent R4
browser review are the current end-to-end evidence.

| Check | Result |
| --- | --- |
| Generated output | 13 tasks passed; 6 collection types current |
| Documentation | 72 documents and 708 links passed through the documented sandbox-safe checker |
| Lint and typecheck | Biome passed 26 tasks; typecheck passed 44 tasks |
| Knip and public exports | Knip clean; 1,210 known exports with no new unconsumed entry |
| Root unit suite | 19 tasks passed; core included 1,109 tests |
| Root integration suite | 26 tasks passed: PostgreSQL 380, MySQL 400, client 169, CLI 2, search 19 per provider, analytics 10 per provider |
| Root build | 22 tasks passed |
| Non-UTC provider/analytics integration | PostgreSQL 380, MySQL 400, analytics 10 per provider under `TZ=Asia/Kathmandu` |
| CLI templates and artifact | Four provider/flavour templates compiled; four baseline files present with no snapshots |
| Native SQL history | 13 released scripts unchanged since `v4.19.0` |
| Changeset | Coordinated fixed-group major resolves from 4.19.0 to 5.0.0 |

The exact final commands were:

```sh
pnpm lint
pnpm byline:generate:check
pnpm typecheck
pnpm knip
pnpm knip:exports
pnpm test
pnpm test:integration
pnpm build
pnpm --filter @byline/cli check:templates
pnpm --filter @byline/cli check:artifact
TZ=Asia/Kathmandu pnpm --filter @byline/db-postgres --filter @byline/db-mysql --filter @byline/analytics-postgres --filter @byline/analytics-mysql test:integration
pnpm check:native-sql-history --base v4.19.0
pnpm changeset status
git diff --check
```

The ordinary documentation command cannot open `tsx`'s IPC socket inside this
sandbox. Its documented equivalent, run from `apps/webapp`, passed:

```sh
node --import tsx byline/scripts/check-docs.ts '../../docs/**/*.md'
```

The first final generation check was incorrectly run in parallel with
typecheck. Rspack reported a cache lock collision and the sandbox rejected the
`tsx` IPC socket. That invocation is not passing evidence. The isolated
`pnpm byline:generate:check` rerun outside the IPC restriction passed all 13
tasks. An earlier root unit run exposed drift in the copied singleton seed; the
seed was converted to `getForEdit()` plus `expectedState: 'empty'`, its mock was
made contract-correct, and the exact-copy test was expanded before the clean
unit and CLI reruns.

## Residual boundaries

Repository evidence cannot establish that any downstream operator has fenced
credentials, terminated sessions, inventoried copied scripts, verified a
backup, or reviewed invalidated schedules. Those checks remain installation
work under the provider runbooks. Rolling mixed-version writers and returning
to v4 writers after v5 writes resume remain unsupported. The local development
ledger reconciliation was manual bookkeeping and is not fresh-install proof.
The retained Playwright suite is legacy; the two-tab in-app-browser exercise
and independent R4 review provide the current editor-flow evidence.

## R5 review focus

Review the complete API and migration diff since `v4.19.0`, this acceptance
matrix, both provider results, CLI template/package/fresh-install evidence,
changeset, developer references and both operator runbooks. Confirm that no
partial or mixed-writer rollout is represented as safe, and that manual local
ledger reconciliation is not presented as proof that a fresh baseline works.
Record repository release readiness separately from permission to merge,
publish or execute an installation cutover.
