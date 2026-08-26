# Singleton Documentation Implementation Plan

> **For implementers:** Work the tasks in order. Each task is an independent
> write → check → commit cycle; do not start a task before its predecessor is committed.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document singletons to Byline's published standard — an authorization recipe for the
private-singleton case, a concept document a stranger can land on and use, API-reference
entries a working developer can scan, and a CLI template that scaffolds a working example.

**Architecture:** One new concept document in `docs/04-collections/`, entries added to the
existing API-reference documents rather than new thin ones, and a recipe added to the auth
Quick reference. No new documentation section.

**Tech Stack:** Markdown under `docs/`, validated by `pnpm docs:check`.

**Spec:** `specs/2026-08-25-singleton-documents-design.md` — this plan implements **Phase 4**
(“documentation”).

**Depends on:** Plans 2, 3, and 4 shipped. Documentation must describe what the code actually
does; writing it against unmerged plans guarantees drift.

## Product neutrality

Byline's published documentation explains Byline on its own terms. It does **not** frame the
product through another CMS, and it carries no migration guidance for one. The internal design
specs under `specs/` may keep their provenance — that is where the reasoning lives — but the
`docs/` corpus stays neutral.

Two pre-existing references must be neutralised as part of this work:

- `docs/04-collections/03-relationships.md:446` — a rejected-alternative note naming another
  product's dot-notation filter syntax. Describe the syntax, not the vendor.
- `docs/03-architecture/01-document-storage.md:214` — a table-per-collection comparison naming
  three products. Describe the architecture ("table-per-collection CMSes"), not the vendors.

Neutralise, do not delete: both sentences carry real technical content, and the point survives
without the brand name.

## Before writing anything

**Load the `writing-docs` skill and read it in full.** It is the repository's documentation
standard and it is enforced — doc type selection, the house front-matter wrapper, the Diátaxis
split, the voice rules, and the link-graph constraints `pnpm docs:check` validates. This plan
states *what* to document; the skill states *how*, and the two are not interchangeable.

Then read the two gold-standard exemplars named there:
`docs/03-architecture/01-document-storage.md` for voice and register, and
`docs/04-collections/05-document-paths.md` for the shape of a reference + explanation hybrid.

## Global Constraints

- **House front matter** on every document: `title`, `path`, `summary`. Unknown keys are a hard
  error; the front-matter `title` must match the first H1; `Companions:` sits immediately below
  the H1 with no blank line, relative `.md` links only, each with a one-line reason.
- **Voice:** address the reader as "you"; name system actors concretely ("the Postgres
  adapter", "Byline's admin interface"), never personified. No "simply", "just", "powerful",
  "seamless", no metaphors or slogans. Em-dash for parenthetical breaks, sentence case
  including headings, code-format every path, table, type, and symbol. British spelling is
  house style.
- **Verify every claim against the merged code**, not against these plans and not from memory.
- `pnpm docs:check` must pass clean after **every** task — which is why the task order below
  puts the anchor-creating work first.
- Conventional commits, `git commit -s`, DCO trailer only.
- **This repository is public.** No client, site, organisation, or domain names anywhere.

---

### Task 1: Document the authorization story for private singletons

This runs **first** because Task 2 links to the anchor it creates, and every task must pass
`pnpm docs:check` independently — the checker resolves anchor fragments against the target
document's real headings.

**Type:** how-to recipe, added to the Quick reference in
`docs/07-auth-and-security/01-authn-authz.md` alongside the six existing recipes.

**Required content**

1. **The `beforeRead` deny result.** Document the widened contract:
   `QueryPredicate | false | void`, where `false` normalises to the existing always-false
   predicate `{ id: { $in: [] } }`, returns an empty result rather than throwing, and cannot be
   overridden by a later hook because hooks combine with logical AND. Update the existing
   guidance, which currently tells readers to write `{ id: { $in: [] } }` by hand — `false` is
   now the clearer way to say the same thing, and both remain valid.
2. **The public/private split recipe**, as the seventh Quick reference entry. State the read
   rule **precisely**: the base ability gate permits an anonymous actor to read *published*
   documents, and `beforeRead` can restrict that further. Do not write "anonymous reads are
   permitted" unqualified — with this feature shipped, that sentence is no longer true as an
   absolute, and the whole recipe is about the qualification.

   The recipe: keep public values in one singleton and private values in another, and give the
   private one a `beforeRead` hook returning `false` for an anonymous actor.
3. **A warning admonition** with a specific title — `:::warning[…]`, never a bare
   `:::warning`. Say plainly that an operational value placed in a public singleton is
   readable by an anonymous client and that **nothing reports the mistake**. Do not write
   "simply readable" — "simply" is on the banned list in the voice rules this plan is
   enforcing.

**Close the existing drift in the same commit**

The auth document and its inbound links are already stale, and adding a seventh recipe makes
the staleness visible:

- `docs/07-auth-and-security/01-authn-authz.md:4` — front-matter `summary` says "six worked
  beforeRead recipes"; make it seven.
- Three inbound cross-links say "six": `docs/03-architecture/index.md:236`,
  `docs/05-reading-and-delivery/01-client-sdk.md:741`, `docs/04-collections/index.md:13`.
- `docs/07-auth-and-security/01-authn-authz.md:695` — the deferred item "**Site-settings
  storage and editor.** Orthogonal to auth. Decide whether to reuse the collection runtime when
  the requirement is in hand." is now shipped. Remove it.

**Gates**

- [ ] `pnpm docs:check` clean
- [ ] The recipe's code runs against the merged `beforeRead` signature
- [ ] `rg -n "six worked" docs` returns nothing
- [ ] The `{ id: { $in: [] } }` guidance is updated, not left contradicting the `false` result
- [ ] `rg -n "simply|just |powerful|seamless" ` over the changed lines returns nothing

---

### Task 2: Write the singleton concept document

**Placement, decided:** `docs/04-collections/09-singletons.md` — the next free prefix. The spec
floated a sibling `docs/04-content-models/` section; do **not** create one. Section 04 already
holds document trees, document paths, and versioning, all content-model concepts rather than
collection features, so a singleton is at home there and a rename is a much larger change than
this feature warrants.

**Type:** reference + explanation hybrid, following `docs/04-collections/05-document-paths.md`.

**Required content**

1. **Overview** — what a singleton is in one concrete sentence, and when you reach for one.
   Define the cardinality invariant precisely: **one named slot per installation, holding zero
   or one persisted document**. "Exactly one" is wrong and the document must not say it — the
   slot exists from registration; the document is materialised by the first save.
2. **The anchoring rules**, stated up front:
   - a singleton's content is an ordinary document, so versions, locales, workflow, history,
     restore, populate, and uploads behave as they do for a collection;
   - reads return `null` until the first save, and that is a normal state a front end renders;
   - there is no list, no create, no delete, and no duplicate;
   - the internal `path` is generated metadata, never an identity and never a URL.
3. **Quick reference**, task-indexed with an **Edit:** line naming the file the reader changes
   and a link down to the deeper section: declare a singleton; give it an admin config and a
   dashboard group; read it from a front end; write to it; add a hook; restrict it to
   authenticated readers (linking to Task 1's recipe anchor).
4. **Detailed sections** — the definition surface, the admin surface, the client handle, hooks
   (`beforeSave` / `afterSave` and the `SingletonSaveOperation` discriminator), workflow choice
   (`SINGLE_STATUS_WORKFLOW` for operational configuration versus the default workflow for
   staged announcements), and the storage model (the mapping table, and why identity is not the
   document path).
5. **Modelling guidance — when a singleton is the wrong answer:**

   | Need | Model |
   |---|---|
   | Site description, default hero/OG image, operational configuration | singleton |
   | Navigation published atomically as one unit | singleton with an array field |
   | Independently authored, individually published menu items | `tree: true` collection |
   | Anything with more than one instance | a collection |

   State plainly that a singleton and collection-level `tree: true` are mutually exclusive, and
   that a recursive embedded `type: 'tree'` field is **not yet shipped**.
6. **Not yet shipped**, fenced honestly: singletons as relation targets, singleton search
   indexing, the embedded `type: 'tree'` field, and multiple singleton instances per tenant or
   site.

**Update `docs/04-collections/index.md` — three separate changes**

- **The overview needs correcting, not just extending.** It currently states that every
  document "is an instance of exactly one" collection and presents `CollectionDefinition` /
  `defineCollection` / `CollectionAdminConfig` / `defineAdmin` as the whole surface. With the
  discriminated union shipped that is no longer accurate: distinguish
  `MultiCollectionDefinition` from the `CollectionDefinition` union, name `defineSingleton` and
  `defineSingletonAdmin` alongside their multi-collection counterparts, and link to the new
  document.
- Add the table-of-contents entry.
- Add **Code map** rows for the singleton definition types, the `byline_singleton_documents`
  mapping table, the singleton lifecycle services, and `SingletonHandle`.

**Gates**

- [ ] `pnpm docs:check` clean — including the anchor into the auth recipe from Task 1
- [ ] Every code example copied from the merged source, not reconstructed — open the files
- [ ] The `writing-docs` self-check answered "yes" on every line
- [ ] The section overview no longer presents multi-collection-only configuration as the entire
      `CollectionDefinition` surface
- [ ] A reader can declare, register, save, and read a singleton using only this document

---

### Task 3: Add the API-reference entries and extend the surface guard

**Type:** reference. Entries go into the **existing** API-reference documents. Do not create
new files — a fifth thin member would fragment the lookup surface.

**Required content**

`docs/10-api-reference/01-configuration.md`:

- the **discriminated schema tuple** — `collections` now holds both kinds, and that is the only
  definition registry
- the lockstep release migration line: `getCollectionDefinition(path)` now returns the
  `CollectionDefinition` union rather than the multi-collection branch alone; downstream code
  that reads collection-only members such as `labels` must first narrow with
  `definition.singleton !== true`. Add the same migration line to
  `docs/01-getting-started/04-upgrading-to-v4.md`
- the additive `DbErrorCodes.FOREIGN_KEY_VIOLATION` member: canonical adapters now classify
  named FK failures as `DB_FOREIGN_KEY_VIOLATION` where they previously returned `DB_UNKNOWN`,
  so downstream exhaustive branches over the exported `DbErrorCode` union must add the new case
- `AdminResourceConfig` as the type of `AdminConfig.admin`
- singleton hook registration through the existing `ServerHooksConfig.collections` registry,
  including the family/discriminant validation and its first-resolution guarantee for loaders

`docs/10-api-reference/02-collections.md`:

- `SingletonDefinition` and `defineSingleton` — every member, which collection-only options are
  `?: never`, and why
- `SingletonAdminConfig` and `defineSingletonAdmin`
- `SingletonHooks` — each hook, its context, and the `SingletonSaveOperation` discriminator with
  the per-branch `data` / `originalData` / `locale` shapes. The `restore` branch is
  **all-locale**; document that explicitly, because a hook author will otherwise assume a
  single-locale shape and misread it

`docs/10-api-reference/04-client-sdk.md`:

- `client.singleton(path)` and every `SingletonHandle` method — signature, parameters, return
  type, and pre-materialisation behaviour (which reads return empty and which mutations throw
  `ERR_NOT_FOUND`)
- `expectedVersionId` and the `ERR_CONFLICT` it raises
- the **two-generic** `BylineClient<TCollections, TSingletons>` signature, both defaulted, and
  how the generated `SingletonFieldsByPath` registry reaches it through the `Register`
  declaration merge

`docs/07-auth-and-security/01-authn-authz.md`:

- the `singletons.<path>.*` ability namespace — four verbs (`read`, `update`, `publish`,
  `changeStatus`), and why there is no `create`, `delete`, or `reindex`

**Extend the API-surface guard**

`apps/webapp/byline/scripts/lib/docs-api-surface.ts` exhaustively checks documented API surface
against the code. Extend it so `defineSingleton`, `SingletonDefinition`, `SingletonAdminConfig`,
and `SingletonHandle` are covered. Without this, a later change to any of them can drift from
these documents with nothing failing.

Each entry follows the reference skeleton: signature, parameters, returns, constraints, then a
two-to-six-line example. No narrative.

**Gates**

- [ ] `pnpm docs:check` clean
- [ ] Every signature matches the merged source exactly — open the files and copy
- [ ] The surface guard fails if a singleton symbol is renamed — verify by renaming one
      temporarily and watching the check break
- [ ] Deferred surface is fenced under an existing "Not yet shipped" heading, not implied

---

### Task 4: Add the CLI template example and close the loop

**Required artifacts** — the singleton needs the same set the collection example has, and two
of them do not exist yet:

1. **Route templates.** `packages/cli/src/templates/` has no singleton editor or history route
   template. Add both, matching the one-line registration shape of the existing collection route
   templates and pointing at the factories Plan 4 exports.
2. **Schema** — a generic site-settings shape: a required text field, a localized `textArea`
   with length validation, and a `relation` to the media collection. Keep it aligned with the
   worked webapp example from Plan 4 Task 6 so the two do not teach different shapes.
3. **Admin registration** — a `defineSingletonAdmin` config registered in the template's
   existing `admin` tuple, with `tabSets` + `layout` and a `preview` returning `/`.
4. **Idempotent seed** — through the system `SingletonHandle`, and only when the slot is empty,
   so re-running the seed neither overwrites edits nor mints a pointless version.
5. **Generated output** — the template's committed `generated/collection-types.ts`, regenerated.
6. **Exactness contract** — the template's `collection-types.contract.ts`, extended to cover
   the singleton registries.

**Verification, corrected**

Root `pnpm byline:generate:check` is `turbo run byline:generate:check`, and only the root and
`apps/webapp` define that script — it does **not** reach the CLI templates. Verifying the
template requires a CLI-side check:

- add a template/emitter contract test in `packages/cli` asserting the template's generated
  output matches what the emitter produces for its definitions;
- run `pnpm --filter @byline/cli test` explicitly.

**Cross-links**

From `docs/09-admin-ui/index.md` and `docs/05-reading-and-delivery/01-client-sdk.md` to the new
concept document, each with a complete sentence saying what the reader will find — not a
noun-phrase teaser.

**README:** if it enumerates content-model concepts, add singletons. If it does not, change
nothing — the README is allowed a different register and is not part of the docs corpus.

**Gates**

- [ ] `pnpm docs:check` clean
- [ ] `pnpm --filter @byline/cli test` green, including the new template/emitter contract
- [ ] `pnpm byline:generate:check` passes for the webapp
- [ ] `pnpm test` green
- [ ] `byline init` with examples scaffolds an app whose singleton opens in the admin, with both
      routes reachable
- [ ] The template example and the webapp example declare the same shape

---

## Out of scope for this plan

- A `docs/04-content-models/` section rename.
- Documenting the embedded `type: 'tree'` field — it is unshipped, and Byline's convention is
  to fence unshipped surface, not describe it as if it exists.
- Migration guidance framed around another CMS. See **Product neutrality** above.
- Translating documentation. The docs corpus is English; `@byline/i18n` covers the admin
  interface, which is a different surface.

## Final verification

- [ ] **`rg -n '\bPayload\b' docs` returns no matches** — the two pre-existing references
      neutralised, and nothing new introduced
- [ ] `pnpm docs:check` clean
- [ ] `git diff --check` clean
- [ ] `pnpm lint` — inspect the diff
- [ ] `pnpm test` green
- [ ] Every new document carries `title` / `path` / `summary`, with `title` matching its H1
- [ ] Every relative link resolves to a `.md` file inside `docs/`, and every anchor names a
      heading that exists
- [ ] Every admonition carries a specific title
- [ ] A reader who has never seen Byline can go from the concept document to a working
      singleton without opening the source
- [ ] No client, site, organisation, or domain name appears in any file
- [ ] Every commit carries a DCO `Signed-off-by` trailer and no others:
      `git log --format='%H %(trailers)' origin/develop..HEAD`
