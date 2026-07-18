# Path grammar — analysis and reconciliation plan

Working document. Delete once the work lands (same lifecycle as the former
`ISSUE-array-fields-in-blocks.md`).

Prompted by review of `5ce65e7e` (dotted schema-path keys in field admin
config), `ec8f3072` (arrays in blocks), `42a7023a` (array item validation).
The review of `5ce65e7e` found the dotted notation was sound in isolation but
that the codebase had accumulated several similar-looking path notations with
divergent rules. This document records what was empirically verified, corrects
several errors in the initial review, and proposes the reconciliation.

Status: **plan agreed, not yet implemented.**
Date: 2026-07-18.

---

## 1. Method

The initial review was built from reading diffs and grepping — inference, not
observation. Several claims turned out to be wrong. Everything in §3 and §4
below was therefore re-established by executing the real entry points against a
fixture exercising every structural combination (group-in-array, array-in-group,
array-in-block, block-in-array, two same-`blockType` sites).

Probe scripts were run ad hoc; they are promoted to a permanent contract test in
Phase 1 below rather than being kept as scratch files.

---

## 2. Corrections to the initial review

Recorded because the corrections are as instructive as the findings.

1. **Storage path shape was stated wrongly.** The review gave
   `content.1.photoBlock.0.display`. Actual emitted output is
   `content.1.photoBlock.display` — there is no index between the blockType and
   the field name. The error was copied verbatim from `CLAUDE.md`, which is
   itself incorrect. Fix listed in Phase 4.

2. **`search.body` does not accept dotted paths.** `docs/04-collections/01-fields.md:441`
   claims schema paths are "used by … `search.body` declarations". False.
   `searchReferencedFieldNames` (`validate-collections.ts:115`) collects flat
   names, and `validateVirtualFields:178` gates comparison behind
   `const isTopLevel = !fieldPath.includes('.')`. Search is top-level-only and
   drops out of this work entirely. Fix listed in Phase 4.

3. **Dot-free field names are already enforced globally.** The review
   recommended adding this. It exists: `assertDotFreeSegment`
   (`attach-hooks.ts:196`) runs on every field name and every blockType in every
   collection. The walk at `attach-hooks.ts:163` calls it before checking
   upload-capability, and `prepareHookAttachment` runs over all collections
   regardless of whether hooks are configured (`config.ts:112`). Covered by
   `attach-hooks.test.node.ts:212,222`. **No work required.**

4. **The dialect inventory was incomplete** — five identified, eight exist.
   Missed: patch `[id=…]` stable-identity addressing, the `UploadConfig.context`
   slash-relative grammar, and counter object-paths.

Claims that survived verification: `walkFieldsWithPath` output is user-facing;
the upload registry is blockType-qualified; admin `fields{}` rejects both
indices and blocks traversal; upload leaf-name uniqueness is enforced at boot
(`attach-hooks.ts:171`); `defaultSort` / `itemViewSort` are top-level-only
(`validate-admin-configs.ts:271`).

---

## 3. Verified inventory

Target field throughout: `alt`, inside array `gallery`, inside block
`photoBlock`, inside blocks field `content`, in collection `pages`.

| Dialect | Key for that field | Index form | Block form |
|---|---|---|---|
| Storage `field_path` | `content.0.photoBlock.gallery.0.alt` | `.n` positional | blockType **after** index |
| Upload registry | `pages.content.photoBlock.gallery.alt` | none | blockType, collection-prefixed |
| Validation errors | `content.gallery.alt` | none | blockType **dropped** |
| Admin `fields{}` | *unreachable* | rejected | rejected |
| Patch paths | `content[id=…].gallery[id=…].alt` | `[n]` or `[id=…]` | transparent |
| Form instance paths | `content[0].gallery[0].alt` | `[n]` | transparent |
| Upload `context` | `../caption`, `/title` | — | slash-relative, layered on instance path |
| Counter paths | dotted; bails on arrays entirely | — | — |

Producers and consumers:

| Site | Role |
|---|---|
| `db-postgres/…/storage-flatten.ts:52` | produces storage paths |
| `db-postgres/…/storage-restore.ts:404`, `storage-queries.ts:597` | consumes storage paths |
| `core/config/attach-hooks.ts:163` | produces upload registry keys |
| `core/config/validate-collections.ts:92` | produces validation error paths |
| `core/config/validate-admin-configs.ts:36` | consumes admin `fields{}` keys |
| `core/patches/apply-patches.ts:42` | consumes patch paths |
| `admin/forms/upload-executor.ts:277` | consumes instance paths, derives declaration paths |
| `admin/forms/upload-executor.ts:216` | consumes `context` slash-relative paths |
| `core/services/assign-counter-values.ts:85` | consumes counter object-paths |

### 3.1 Two demonstrated defects

**Validation error paths are ambiguous.** Two blocks in one blocks field each
declaring a field named `alt` both render as `content.alt`. The message cannot
identify which declaration is at fault. User-facing.

**Patch paths cannot consume storage paths.**
`parsePatchPath('content.0.photoBlock.alt')` yields field segments literally
keyed `"0"` and `"photoBlock"` — a silent misparse with no error. Not currently
reachable in product code, but nothing prevents it.

---

## 3.2 Downstream check (completed)

Three production consumers, all checked:

- FORRU — `/Users/tony/Clients/FORRU/01-Website/Solutions/beta.forru.org`
  (plus its own `search-solr`, `extract-postgres`, `extract-tika` packages)
- bylinecms.app — `/Users/tony/Clients/Infonomic/Projects/Byline/Solutions/bylinecms.app`
- Modulus — `/Users/tony/Clients/OSU/Solutions/modulus-learning.org`

**Governing rule (Tony, 2026-07-18): "do the right thing."** FORRU is in beta
and only partly migrated; the other two consumers are ours and cheap to update.
Downstream compatibility is therefore a *cost to weigh*, not a hard constraint.
Concretely this relaxes three things:

- Phase 2c need not be strictly output-preserving — FORRU's live dotted keys can
  be updated if a better design warrants it.
- Removing the upload leaf-uniqueness constraint (Phase 3) is on the table.
- FORRU's extraction walker (§3.2.1) is a legitimate migration target rather
  than a compatibility burden.

Results:

1. **No coupling to Byline error text.** Every `toThrow` across the three
   matches the consumer's own messages. **Phase 2a is safe to ship standalone.**
2. **No downstream upload registry key traverses blocks.** FORRU:
   `publications.publicationCover`, `publications.files.filesGroup.publicationFile`.
   App and Modulus: `media.image`. Phases 2b / 2d carry no downstream exposure
   to the blockType question.
3. **FORRU already uses dotted block-admin keys in production** —
   `'faq.answer'` (`faq-block.admin.ts:32`) and `'items.description'`
   (`timeline-block.admin.ts:32`), both group/array, no blocks. **Phase 2c must
   be strictly output-preserving** — these are live.
4. **`search-solr`'s `path` is the document URL path, not a field path.** No
   coupling.

### 3.2.1 The wildcard dialect — a workaround, not a requirement

FORRU has a path notation not present anywhere in this monorepo
(`apps/webapp/byline/extraction/config.ts:71`):

```ts
file: 'files[].filesGroup.publicationFile',
language: 'files[].filesGroup.language',
```

Resolved by a hand-rolled walker (`collect-attachments.ts:60-90`) in which `[]`
means "fan out across every item", recording an **index trail** so that the two
sibling paths resolve against the *same* array item — pairing each file with its
own language.

Critically: `files[].filesGroup.publicationFile` and the upload registry key
`publications.files.filesGroup.publicationFile` address the identical field. The
`[]` marker carries no information the schema does not already hold — `files` is
declared an array. FORRU needed the marker only because their walker is
schema-*unaware*: it walks data with no access to field definitions, so it
cannot know where to fan out.

So this is not a ninth dialect to accommodate. It is a workaround for the
absence of the thing this plan builds, and a schema-aware resolver obsoletes it.

Two consequences:

- **Do not add `{kind: 'wildcard'}` to the AST.** That would enshrine the
  workaround. The schema-aware resolver removes the need for the marker.
- **The index trail is a genuine gap and survives.** Paired resolution — fan out
  once, resolve sibling paths against the same item — is a *resolver* capability
  absent from core. But it has exactly one consumer, so it is a Phase 3
  candidate, not a public API to design around a single data point.

Note also a latent conflict if wildcards were ever adopted: the admin `fields{}`
validator rejects any key containing `[` outright
(`validate-admin-configs.ts:68`), so wildcard and admin-key grammars could not
share a parser without a policy exception.

---

## 4. The organising insight

The eight dialects are not eight arbitrary formats. They are two categories
separated by one rule, and that rule explains every difference — including the
ambiguity defect.

- **Instance paths** address *items*. Indices are required. The blockType is
  redundant, because the item itself carries `_type`.
- **Declaration paths** address *schema nodes*. There are no indices. The
  blockType is **required**, because without it two blocks declared in the same
  field are indistinguishable.

The evidence: take the storage path `content.0.photoBlock.gallery.0.alt`, elide
the index segments, and the result is `content.photoBlock.gallery.alt` — the
upload registry key exactly. Those two are already the same grammar modulo
index elision. That was not designed; it fell out of both being written
correctly.

The defect states the same way. `walkFieldsWithPath` emits a *declaration* path
with the blockType omitted — ambiguous precisely because it breaks the one rule
declaration paths have. Patch paths omit blockType too, but they are instance
paths, so they are sound.

So the work is not "unify eight formats". It is **one AST, two serialisations,
and a policy flag** — where the flag (`blocks: 'forbidden'`) is what admin
`fields{}` layers on top, justified by the `blockAdmin` registry owning that
surface.

---

## 5. Scope

Split by mutability, which is a sharper line than "storage is out".

| Concern | In / out | Reason |
|---|---|---|
| Storage `field_path` | **Out** | Persisted data; changing it is a migration |
| Patch paths | **Deferred to Phase 3** | Wire format; revisit only if free |
| Upload registry keys | In | Config-time |
| Admin `fields{}` keys | In | Config-time |
| Validation error paths | In | Config-time, and carries the ambiguity defect |
| Upload `context` | **Out** | A relative-addressing language layered *on* instance paths, not a path dialect |
| Counter paths | **Out** | A data-object accessor, not a schema path — rename only, so it stops reading as one |

---

## 6. Plan

### Phase 1 — grammar module

New `packages/core/src/paths/`, modelled on how `field-store-map.ts` became the
single source of truth for field→store mapping.

One AST:

```ts
type PathSegment =
  | { kind: 'field'; name: string }
  | { kind: 'index'; index: number }
  | { kind: 'id'; id: string }
  | { kind: 'blockType'; blockType: string }
```

Surface:

- `parseDeclarationPath` / `formatDeclarationPath` — index-free, blockType-qualified
- `parseInstancePath` / `formatInstancePath` — bracket indices, blockType transparent
- `toDeclarationPath(instance)` — elide index segments; the bridge
  `upload-executor.ts:277` currently hand-rolls with a regex
- `resolveDeclarationPath(fields, path, { blocks: 'qualified' | 'forbidden' })`
  — returns the resolved field plus the `'ok' | 'blocks' | 'unresolved'` status
  that `5ce65e7e` already models correctly

**Characterization tests land first**, pinning current output for every dialect
in §3 against the shared fixture. Behaviour is locked before anything moves, so
each later step either preserves output or shows a deliberate diff.

### Phase 2 — migrate config-time consumers, one commit each

- **2a. `walkFieldsWithPath` → blockType-qualified. DONE.** Now delegates to
  `walkFieldDeclarations`; the local recursive walk is deleted.
  `content.gallery.alt` → `content.photoBlock.gallery.alt`. Message text only —
  the set of fields visited and every accept/reject decision are unchanged.
  Verified end to end: a collection with `caption` declared in two block types
  now reports `content.videoBlock.caption`, naming which declaration is at
  fault, where both previously rendered as `content.caption`.

  Note for later phases: the dry run in Phase 1 predicted two failing
  assertions and there were three — `validate-collections.test.node.ts`
  ("validates upload.location on fields nested inside blocks") also pinned the
  ambiguous form. The dry run had only been run against the characterization
  file, not the whole suite. Run the *full* package suite when estimating
  blast radius for 2b–2d.
- **2b. Upload registry (`indexUploadFields`) → shared serialiser. DONE.**
  Byte-identical, verified by diffing real output from the old and new
  implementations (via `git stash`) across seven nesting shapes: top level,
  group, array→group, block, array-inside-block, and block-inside-array. No
  key changed.

  **`walkFieldDeclarations` gained an `onBlock` callback because of this
  phase.** `indexUploadFields` does three jobs, not one: it builds registry
  keys, detects duplicate upload leaf names, *and* asserts every field name and
  block type is dot-free. That last one visits every block — **including a
  block declaring no fields**, which never reaches the field visitor. A
  straight swap to the field-only walk would have silently stopped validating
  those. Caught by probing the edge case before changing anything, and now
  pinned by a test.

  `validateBlockAdminConfigs` has its own block-collecting walker too, so
  `onBlock` should let 2c retire that one as well.
- **2c. Admin `fields{}` (`resolveSchemaPath`) → shared resolver +
  `blocks: 'forbidden'`. DONE.** `resolveSchemaPath` is now a one-line
  delegation; the hand-rolled resolution loop is gone. Unlike 2b there were no
  incidental responsibilities riding along — both walks here were pure
  collection.

  Also retired two further walkers:
  - `validateBlockAdminConfigs`' block collector, now `onBlock`. Verified
    old-vs-new identical across nested blocks (a block inside a block), a
    block inside an array, and the same blockType declared in two collections
    with drifted field sets (union semantics). Nested-block recursion was the
    subtle part and is now pinned by a test.
  - `validate-collections`' path-free `walkFields`, now a delegation. Costs a
    segment array per field on a walk that ignores paths — irrelevant at boot,
    and it removes the last duplicated descent in that file.

  Net: −51 lines in `validate-admin-configs.ts`, and the hand-rolled descents
  this work started with are gone from `packages/core/src/config/`.
- **2d. `findUploadFieldByPath` → schema + data resolution. DONE.**

  **The plan's design for this phase was wrong.** "`toDeclarationPath` +
  registry lookup" cannot work: a form field path is an *instance* path
  (`content[1].gallery[0].poster`) and carries no block type, so
  `toDeclarationSegments` yields `content.gallery.poster` — not a valid
  declaration path, and no string processing recovers the discriminator.

  The model says where it lives: instance paths omit the block type *because
  the item carries it*. `executeUploads` already receives `getFormValues`
  (`form-renderer.tsx:400`) and block items carry `_type`
  (`blocks-field.tsx:160`), so the walk now descends schema and form data
  together, reading `_type` at each block hop. Where data can't disambiguate
  (stale form state, no execution context) it tries every block and accepts
  only a unique match — ambiguity returns nothing rather than a guess.

  **The bug was reachable and silent.** Leaf-uniqueness constrains only
  upload-capable leaf names, not intermediate ones. Two blocks each declaring
  an array named `gallery`, one holding `heroImage` and the other `poster`,
  boots cleanly — but uploading `poster` matched `gallery` in the *first*
  block, failed to find `poster` there, and dropped the declared
  `upload.context` with no error. Server-side `beforeStore` / `afterStore`
  hooks simply never received it.

  Verified by six tests added to the existing `executeUploads` harness, five
  of which fail against the old implementation. The sixth is the first-block
  case, where the guess happened to be right — the shape of the bug exactly.
  Playwright was not needed: the harness drives the real entry point with a
  real `FieldSet` and `File` against a mocked transport, asserting on outgoing
  `FormData`.

  Remaining gap, for a manual check: the harness supplies `fieldPath` itself,
  so it cannot prove the paths the widgets emit match. Verified by reading
  (`blocks-field.tsx:222`), not by running.

### Phase 3 — evaluate, do not presume

- `parsePatchPath` already has `field` / `index` / `id` segment kinds — that is
  the instance AST minus blockType. It may collapse into `parseInstancePath` for
  free. It is a wire format, so look before committing.
- Whether the upload leaf-uniqueness constraint becomes removable once 2d lands.
  Probably, but removing it changes which configs boot — a follow-up with its
  own decision.
- Rename the counter object-path helper so it stops reading as a schema path.
- **Paired resolution / index trail** (see §3.2.1). FORRU fans out a declaration
  path across array items and resolves sibling paths against the same item. A
  real capability gap, but one consumer — decide whether it belongs in core
  after Phases 1–2 land, not before.

### Phase 4 — documentation

**Corrections — DONE (uncommitted at time of writing).** Shipped as their own
change ahead of the refactor:

- `CLAUDE.md:84` — storage path example corrected, plus a note on how blocks and
  array items contribute segments
- `docs/03-architecture/index.md:19` — same example, same error
- `docs/04-collections/01-fields.md` §"Schema paths vs instance paths" —
  removed the false `search.body` claim; corrected the over-generalisation that
  schema paths "never traverse a `blocks` field" (that is the admin `fields{}`
  *policy*, not the grammar — the upload registry qualifies with a block type);
  added the upload hook registry to the consumer list; explained *why* the
  block-type segment exists; softened the `findUploadFieldByPath` overclaim;
  added a temporary known-inconsistency note covering the Phase 2a bug (delete
  that note when 2a lands)

**Provenance of the storage-path error.** Traced via `git log -S` to
`447d6f31 docs: updated Claude.md and added STORAGE-ANALYSIS.md`. It originated
in an early analysis document and was copied forward — it was never a real
format. `docs/03-architecture/01-document-storage.md:95-100` has always been
correct, so the summary prose contradicted the detailed reference in the same
directory. This is the error that misled the initial review in §2.1.

**Outstanding — CLI template fixtures (NOT fixed, decision needed).**
`packages/cli/src/templates/byline-examples/collections/doc-example-flat-locale-en.ts`
and `…-locale-all.ts` carry the same error, but systematically rather than as a
typo. They use a sequential per-field counter after the block type:

```
content.1.photoBlock.0.display     parent_path: content.1.photoBlock.0
content.1.photoBlock.1.photo       parent_path: content.1.photoBlock.1
content.1.photoBlock.2.alt         parent_path: content.1.photoBlock.2
content.1.photoBlock.3.caption     parent_path: content.1.photoBlock.3
```

No such ordinal exists in the real format. Correct output for those four fields
of one `photoBlock` item is `content.1.photoBlock.{display,photo,alt,caption}`,
all with `parent_path: content.1.photoBlock`.

These are unexported, unreferenced constants — inert data, no runtime risk — but
`byline init` copies them into user projects as reference material for what
storage rows look like, so they actively teach a wrong model.

**Recommendation: generate, do not hand-edit.** Produce the fixtures by running
the real flattener over the example document and serialising the output. Hand
-typing "what the format probably is" is precisely how the original error was
introduced; repeating that process to fix it would be the same mistake with a
different value. Worth its own commit with the generator retained or referenced.

Then the canonical documentation. One owner, one link — not parallel sections,
since duplicating the table in two docs is a small version of the exact problem
being fixed:

- **`docs/03-architecture/02-path-grammar.md`** owns the full model: the
  instance/declaration distinction, the AST, the complete table, and why storage
  and patch formats are frozen. It belongs in architecture because it spans
  storage, config, and the patch wire format — no single collections doc
  legitimately covers all three.
- **`docs/04-collections/01-fields.md`** gets a short subsection covering only
  what a collection author types: declaration paths, the blocks boundary, the
  `blockAdmin` handoff. Links to the architecture doc for the rest.

### Phase 5 — guardrail

The Phase 1 characterization file becomes a permanent contract test enumerating
every dialect against the shared fixture — the analogue of
`field-store-map.test.node.ts`. A ninth dialect, or a change to an existing one,
surfaces there.

---

## 7. Open questions

1. ~~**Downstream blast radius.**~~ **Resolved — see §3.2.** No error-text
   coupling; no downstream upload key traverses blocks; FORRU's live dotted
   block-admin keys constrain 2c to be output-preserving.
2. **2a timing.** Cheapest user-visible win and independent of the refactor.
   Leaning standalone — a bug fix should not wait on a refactor — at the cost of
   touching `walkFieldsWithPath` twice. Now unblocked by §3.2 finding 1.
3. **Does FORRU's extraction walker migrate?** Once the schema-aware resolver
   exists, `collect-attachments.ts` could drop its `[]` markers and its
   hand-rolled walker. Out of scope for this monorepo's work, but worth raising
   with the FORRU codebase once Phase 1 lands — it is the first real test of
   whether the shared grammar serves an outside consumer.
