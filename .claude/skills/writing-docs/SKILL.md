---
name: writing-docs
description: Use when creating, rewriting, tightening, or reviewing any Byline CMS documentation — the numbered section directories under docs/ (getting started, why Byline, architecture, collections, reading and delivery, auth and security, internationalization, admin UI) and per-package DESIGN.md files. Trigger whenever the user asks to write, draft, improve, or review a doc; add a setup or getting-started section; document a subsystem, package, or API; or turn design notes into reference. Also use whenever a new subsystem or package ships and needs documenting. This skill encodes Byline's documentation standard — doc-type selection, required structure, definition-before-use, runnable code examples, and house voice — so new and revised docs land first-class rather than "not terrible."
---

# Writing Byline docs

Byline's docs are technically dense but uneven: some open in the middle of a subsystem with no orientation, use domain terms (`store_*` tables, `ReadContext`, the relation envelope) before defining them, and lean on prose where a code example would settle the point in five lines. This skill exists to close that gap. The bar is not "accurate." The bar is: a competent developer who has never seen Byline can land on the page, know within two sentences what it is and whether it's for them, and leave able to *do* the thing — with working code, not paraphrase.

Read this whole file before writing. Then read the relevant implementation, manifests, and tests: the code and executable config are the source of truth, and the doc must describe what the code actually does — not what memory or an older doc suggests. Then pick a doc type, follow its skeleton, and run the self-check at the end before you call it done.

## Step 1 — Pick the doc type first

Most weak Byline docs fail because they try to be a tutorial, a reference, and an essay at once. Decide which one you're writing. The four types come from Diátaxis (diataxis.fr); each has a different job and a different shape, and they must not blur inside a single section.

| Type | Job | Byline examples |
|------|-----|-----------------|
| **Tutorial** | Teach a newcomer by walking them through a guaranteed-to-work path. Learning-oriented. | `docs/01-getting-started/index.md`, `docs/01-getting-started/02-development-environment.md` |
| **How-to / recipe** | Get a competent user to an outcome for a specific task. Assumes background. | the Quick Reference recipes in `docs/06-auth-and-security/01-authn-authz.md`, the per-task entries in `docs/04-collections/05-document-paths.md` |
| **Reference** | Let a working developer look up exact facts fast. No narrative. | the surface sections of `docs/04-collections/01-fields.md`, `docs/05-reading-and-delivery/01-client-sdk.md`, the `store_*` table listings |
| **Explanation** | Build understanding — the "why", the tradeoffs, the rejected alternatives. | `docs/02-why-byline/01-mission.md`, `docs/03-architecture/index.md`, `packages/client/DESIGN.md` |

The numbered subsystem docs (`docs/03-architecture/01-document-storage.md`, `docs/04-collections/05-document-paths.md`, `docs/04-collections/03-relationships.md`, …) are deliberately **reference + explanation hybrids**. That's allowed — but section them so the two stay separate: an explanation part ("how it works and why") and a reference part ("the exact surface"). Do not answer a "why" question in the middle of a lookup table, or drop an API signature into a paragraph of rationale.

If you can't name the type in one word, the doc isn't scoped yet. Split it.

## Step 2 — Use the skeleton for that type

Every doc, whatever its type, opens with the same house wrapper; the type-specific skeleton is the body that follows it.

### House format (every doc)

Docs under `docs/` are processed by an import pipeline and validated by `pnpm docs:check`, so the top of the file is not free-form:

```markdown
---
title: "Human-readable title"
path: "url-slug"
summary: "One sentence describing what the document explains."
---

# Human-readable title

Companions:
- [Related topic](./relative-path.md) — why it's relevant.
```

- **Only `title` is enforced** by the checker; `path` falls back to a slug derived from the title and `summary` is optional. House convention is to write all three explicitly, so do — a doc missing `summary` will pass the gate and still be wrong.
- **Unknown front-matter keys are a hard error.** The allowed set is `title`, `path`, `summary`, `status`, `locale`, `publishedOn`, `featureImage`, `constrainedWidth`. A typo does not silently no-op; it fails the file.
- The front-matter `title` and the first H1 must match. The comparison is case-insensitive against the H1's flattened text, so inline formatting in the H1 is fine — `# Client SDK (\`@byline/client\`)` matches `title: "Client SDK (@byline/client)"`. Never put backticks or emphasis in the front-matter title itself. On a mismatch the pipeline renders both, producing a duplicate heading.
- `Companions:` goes immediately below the H1, with the list on the next line (no blank line between). Relative links only, each with a one-line reason. Include a doc only if it's a genuine prerequisite, an adjacent concept, or a more detailed contract — and link it rather than repeating its explanation.

In the skeletons below, the `# <Title>` line is this same H1, sitting under the front matter.

### Where the file goes

`docs/` is organised as numbered section directories, each with an `index.md` plus `NN-`-prefixed member documents:

```text
docs/01-getting-started/   02-why-byline/   03-architecture/   04-collections/
docs/05-reading-and-delivery/   06-auth-and-security/   07-internationalization/   08-admin-ui/
docs/09-testing.md
```

Place a new doc in the section whose subject it belongs to and give it the next free `NN-` prefix. The `index.md` of that section is its overview and table of contents — add the new document to it. If nothing fits, say so and ask rather than inventing a section.

### What `pnpm docs:check` enforces

Beyond front matter and the H1 match, the checker validates the link graph. Each of these fails the build:

- **Relative links must resolve to a file inside the import set** (`docs/**/*.md`). A relative link out of `docs/` — `../../README.md`, `../../RELEASE-INSTRUCTIONS.md` — is an error. Link repo-root files as absolute GitHub URLs instead.
- **Relative links must end in `.md`.** A bare relative target resolves against the published `/docs/` route and is rejected.
- **Anchor fragments are resolved against the target document's headings.** `[…](./05-document-paths.md#path-uniqueness)` fails if that heading doesn't exist — this applies to same-document anchors too.
- **Canonical routes must be unique.** Two documents whose front-matter `path` (or title-derived slug) collide is an error.

### Tutorial
```
# <Title>
One sentence: what the reader will have built/running by the end.

## Prerequisites
Exact versions and env (Node/pnpm, Postgres, an initialised DB). No "recent version of X".

## Steps
For each step, in this order:
  1. The command or code block (copy-paste-able, complete)
  2. What to expect — the real output, the URL, the row that appears
  3. One line on why this step matters (only if non-obvious)

## Checkpoint
"You should now see …" — a concrete, verifiable end state.

## Next
Where to go from here (link the relevant subsystem docs).
```
A tutorial that can fail silently is broken. Every step must be runnable as written and must tell the reader how to know it worked.

### How-to / recipe
```
# <Task stated as a goal>  e.g. "Restrict drafts to their owner"
One line: what this achieves and when you'd reach for it.

## Assumptions
One or two lines — what must already be true (a collection defined, a realm configured).

## Recipe
The minimal, complete code that does the job. Real Byline APIs, not pseudocode.

## Variations / edge cases
The two or three ways real usage bends this (multi-tenant, embargo, soft-delete).
```
A recipe is not a tutorial: assume competence, skip the hand-holding, get to the code.

### Reference
```
# <Subsystem / API>
One line: what this surface is.

## <Each item>
- Signature / schema / table shape
- Parameters — name, type, required?, meaning
- Returns / stored shape
- Constraints and gotchas
- One tiny example (2–6 lines)

## Not yet shipped
Anything deferred, clearly fenced off (Byline already does this well — keep it).
```
Reference is consulted, not read. Optimise for someone scanning with Cmd-F, not reading top to bottom. No story.

### Explanation
```
# <The question it answers>  e.g. "Why immutable versioning?"
## The problem / context
## The design
## The tradeoffs — including what we rejected and why
```
No numbered steps. This is for understanding, so it's allowed to be discursive — but it still opens by naming the question it answers.

### Section conventions in the subsystem docs

The reference + explanation hybrids follow a settled shape. Match it when you add or revise one:

1. `## Overview` — what the subsystem is, then the two or three rules that anchor the model. This is the orientation the reader gets from a search result.
2. `---` then `## Quick reference` — one entry per task, each with the minimal shape, an **Edit:** line naming the file the reader actually changes, and a link down to the deeper section.
3. The detailed sections — the full contract, per topic.
4. `## Not yet shipped` — deferred work, clearly fenced.

[`docs/04-collections/05-document-paths.md`](../../../docs/04-collections/05-document-paths.md) is the cleanest example of the pattern.

## Step 3 — Apply the universal bar (every type)

These are the things the current docs most often miss. Non-negotiable.

- **Orientation in the first two sentences.** What is this, who is it for, where does it sit? A reader who lands here from a search result must not have to reverse-engineer the context. This is the single most common failure — fix it first.
- **Define before use.** The first time a doc uses a Byline term — `store_*` typed tables, `DocumentPatch`, `ReadContext`, the relation envelope, `useAsPath`, `defineAdmin`, the collection lifecycle hooks (`beforeRead` / `afterRead` / `beforeCreate`) or the upload hooks (`beforeStore` / `afterStore`, which are a different family on the field's upload config) — define it in a clause or link to the doc that does. Never assume the reader arrived via the doc that would have defined it.
- **Show, don't paraphrase.** If a point can be made in code, make it in code. Examples must be real (actual Byline APIs and types), complete (copy-paste-able, imports included where they matter), and minimal (nothing incidental). A toy example that doesn't reflect real usage is worse than none — it teaches the wrong shape.
- **Be honest about shipped vs deferred.** Keep the existing convention of naming what's implemented and what's a future phase. Never document aspirational API as if it exists.
- **Cross-link.** Every term you *don't* define here should link to the doc that does. Docs are a graph, not a pile.
- **One concept per section.** If a heading covers two ideas, split it.

## Voice

Plainer than the README. The README is allowed marketing energy — slogans, "foot-gun protection", the three-pillars framing. Docs are not. A doc describes what the system does, directly, for a developer evaluating or learning Byline. No metaphors, slogans, compressed fragments, or rhetorical flourishes, and nothing that asks the reader to infer unstated context.

- **Address the reader as "you."** "You declare a field on two sides", "read this document when you are wiring an adapter" — not "one declares" or "the developer declares". Open every document by orienting that reader: what the subject is, in one concrete sentence, and when they would reach for it. This is separate from naming *system* actors (below): the Postgres adapter and the server are still "the Postgres adapter" and "the server", never personified and never "you". The gold-standard exemplars show the register in practice.
- **Do:** write clear, grammatically complete sentences; name concrete subjects — "Byline's admin UI", "the server", "the Postgres adapter" — not vague shorthand like "the admin"; state limitations plainly; use active voice; reach for a small table or example when it makes a distinction easier to scan.
- **Don't:** "simply", "just", "easy", "powerful", "seamless"; marketing adjectives; metaphors and slogans; hedging ("it might be possible to perhaps…"); undefined acronyms; a wall of prose where a list or code block is clearer.
- **Plain English must not weaken the contract.** Simplify the wording, never the meaning: keep the precise limits, boundaries, and technical qualifications intact. A doc that reads easily but softens a guarantee is wrong.
- **Signpost a link with a complete sentence that says what the reader will find.** "All four deployment scenarios, current and future, are described in [Deployment Topologies](…)" — *not* a teaser: a list of noun-phrase fragments, a colon, and a link ("All four shapes, what stays constant across them, and why the SDK is never split from the runtime it calls: [Deployment Topologies](…)"). The fragment version withholds the very thing the reader needs to decide whether to click, and reads as mysterious rather than helpful. "See [X](…) for Y" and "[The X guide](…) covers Y" are both fine; a dangling "— is in [X](…)" that strands the verb at the end of a long interrupted clause is not. The same applies to a section's closing pointer and to `Companions:` reasons.

### House mechanics

- Em-dash (—), not a hyphen, for parenthetical breaks.
- Sentence case everywhere, including headings: "Not yet shipped", not "Not Yet Shipped".
- Code-format every file path, table name, type, and symbol: `docs/04-collections/01-fields.md`, `store_text`, `ReadContext`.
- British spelling is fine and used throughout the corpus ("materialises", "behaviour", "normalises"). Don't convert existing text either way.
- Prefer a relative link to a companion document over restating its explanation.
- **Admonitions are Docusaurus-style and always carry a title**: `:::note[Tested configuration]`, `:::warning[Foot-gun protection]`, `:::tip[…]`, closed by `:::` on its own line. A bare `:::note` is wrong — the title is what a reader scanning the page sees, so make it say something specific ("Keep public and admin layouts separate", "upload.storage is server-only"), not just restate the type. Use sentence case, and reach for an admonition only when the point genuinely interrupts the flow; a paragraph that could sit in the body should stay in the body.

## Anti-patterns — what "not first-class" looks like here

Name these when reviewing; avoid them when writing.

1. **In-medias-res opening** — the doc starts explaining a mechanism before saying what the mechanism is for.
2. **Undefined jargon** — `ReadContext` / envelope / `store_*` used pages before (or without ever) being defined.
3. **Assertion without code** — "documents flatten into typed tables" with no example of a document going in and rows coming out.
4. **Toy code** — invented field names and fake APIs instead of real Byline surface.
5. **Blurred type** — a lookup table interrupted by three paragraphs of rationale, or an essay that suddenly lists function signatures.
6. **Stub-as-doc** — a heading with "TODO" or one hand-wavy sentence under it, shipped as if complete.
7. **Prose where a table/list wins** — parameters, options, or comparisons buried in sentences.
8. **Slogans and metaphors** — README-style flourishes ("three pillars, not three plugins") dropped into a reference doc. Docs describe; they don't sell.
9. **Broken front matter** — missing `title`/`path`/`summary`, an unknown key (a hard error, not a no-op), or a front-matter `title` that doesn't match the first H1 (the rendered page gets a duplicate heading).
10. **Links that don't survive the checker** — a relative link out of `docs/`, a relative target without a `.md` extension, or an anchor fragment naming a heading that doesn't exist in the target.

## Worked example

**Weak (assertion without code, jargon undefined):**
> Documents are addressed by a path notation and flattened into the typed store tables. The path is derived via `useAsPath` and slugified.

**First-class (orients, defines, shows):**
> A document's **path** is its stable, human-readable address — the slug that resolves a URL back to a document, e.g. `hello-world`. It is a reserved system attribute, not a collection field: paths live in their own table, `byline_document_paths`, keyed by `(document_id, locale)` with a unique constraint on `(collection_id, locale, path)`. `useAsPath` on the collection definition names the field whose slugified value initialises the path on create.
>
> ```ts
> // apps/webapp/byline/collections/news/schema.ts
> export const News = defineCollection({
>   path: 'news',
>   labels: { singular: 'News', plural: 'News' },
>   useAsTitle: 'title',
>   useAsPath: 'title', // The `title` field seeds the document path.
>   fields: [
>     { name: 'title', label: 'Title', type: 'text', localized: true },
>     { name: 'summary', label: 'Summary', type: 'textArea', localized: true },
>   ],
> })
>
> // Creating { title: "Hello, World!" } yields a row in byline_document_paths:
> //   document_id  locale  path
> //   <uuidv7>     en      hello-world
> ```
>
> The named field must be top-level and of a path-compatible type (`text`, `textArea`, `select`, `date`, `datetime`, `time`); a collection without `useAsPath` gets a UUID path instead. Each document carries one canonical path, stored under its `sourceLocale` — localised slugs (`/en/about` vs `/de/ueber-uns`) are deferred, and frontends prefix `/{locale}/{path}` over the single canonical value. See [Relationships](../../../docs/04-collections/03-relationships.md) for how `path` is used in relation filters.

Note what the code does that the prose can't: it shows `useAsPath` sitting on the collection rather than the field, and it shows the field literal shape. Both are things a reader would otherwise guess wrong. When you write your own example, open the real schema file and copy the current surface — do not reconstruct it from memory.

## Self-check before finishing

Run this against the draft. If any answer is "no", fix it before delivering.

- [ ] Can a stranger tell what this is and whether it's for them from the first two sentences?
- [ ] Is the doc exactly one type (or a hybrid with cleanly separated reference/explanation sections)?
- [ ] Is every Byline term defined or linked on first use?
- [ ] Does every "you can do X" claim have runnable, real-API code next to it?
- [ ] Are shipped vs deferred features clearly distinguished?
- [ ] Is the voice plain and direct — no slogans, metaphors, or filler words — while keeping every technical qualification intact?
- [ ] Is the reader addressed as "you", with system actors still named concretely (not personified)?
- [ ] Does the front matter carry `title`/`path`/`summary`, with no key outside the allowed set and `title` matching the first H1?
- [ ] Do all relative links point at `.md` files inside `docs/`, and does every anchor fragment name a heading that exists?
- [ ] Does every admonition carry a specific title (`:::note[…]`, `:::warning[…]`)?
- [ ] Is the file in the right numbered section, with the next free `NN-` prefix and an entry in that section's `index.md`?
- [ ] Are code symbols, paths, commands, limits, and behavioural claims verified against the current repo, not memory?
- [ ] Would this doc, as written, actually let someone *do the thing* without opening the source?

The `/document` command runs `pnpm docs:check` as a final mechanical gate — the draft should pass it clean.

## Gold-standard exemplars

Read at least one of these before writing. A concrete exemplar calibrates tone and depth better than any rule above.

- **[`docs/03-architecture/01-document-storage.md`](../../../docs/03-architecture/01-document-storage.md) — the primary model for voice and register.** Read it first. It opens with a vocabulary block that defines every term before use, orients the reader in its first paragraph, addresses the reader as "you" throughout without personifying system actors, walks one concrete document from save to rows to read before the reference sections, and treats the three storage alternatives symmetrically. It is also the model for Companions entries that say *why* the companion is relevant, and for citing external evidence as an absolute URL. When in doubt about tone or how much to show versus tell, match this.
- [`docs/04-collections/05-document-paths.md`](../../../docs/04-collections/05-document-paths.md) — the model for **structure** in a reference + explanation hybrid: Overview with a few anchoring rules, a task-indexed Quick reference with **Edit:** lines, then the full contract, then honest limitations. Match its shape for any subsystem doc.

When revising an existing doc, match the exemplar it is closest to rather than importing a shape from elsewhere.
