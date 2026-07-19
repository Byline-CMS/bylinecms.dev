---
name: writing-docs
description: Use when creating, rewriting, tightening, or reviewing any Byline CMS documentation — the files under docs/ (MISSION, ARCHITECTURE, GETTING-STARTED, the numbered subsystem references, the recipe cookbooks) and per-package DESIGN.md files. Trigger whenever the user asks to write, draft, improve, or review a doc; add a setup or getting-started section; document a subsystem, package, or API; or turn design notes into reference. Also use whenever a new subsystem or package ships and needs documenting. This skill encodes Byline's documentation standard — doc-type selection, required structure, definition-before-use, runnable code examples, and house voice — so new and revised docs land first-class rather than "not terrible."
---

# Writing Byline docs

Byline's docs are technically dense but uneven: some open in the middle of a subsystem with no orientation, use domain terms (`store_*` tables, `ReadContext`, the relation envelope) before defining them, and lean on prose where a code example would settle the point in five lines. This skill exists to close that gap. The bar is not "accurate." The bar is: a competent developer who has never seen Byline can land on the page, know within two sentences what it is and whether it's for them, and leave able to *do* the thing — with working code, not paraphrase.

Read this whole file before writing. Then read the relevant implementation, manifests, and tests: the code and executable config are the source of truth, and the doc must describe what the code actually does — not what memory or an older doc suggests. Then pick a doc type, follow its skeleton, and run the self-check at the end before you call it done.

## Step 1 — Pick the doc type first

Most weak Byline docs fail because they try to be a tutorial, a reference, and an essay at once. Decide which one you're writing. The four types come from Diátaxis (diataxis.fr); each has a different job and a different shape, and they must not blur inside a single section.

| Type | Job | Byline examples |
|------|-----|-----------------|
| **Tutorial** | Teach a newcomer by walking them through a guaranteed-to-work path. Learning-oriented. | `GETTING-STARTED.md` |
| **How-to / recipe** | Get a competent user to an outcome for a specific task. Assumes background. | `ACCESS-CONTROL-RECIPES.md`, `RELEASE-INSTRUCTIONS.md` |
| **Reference** | Let a working developer look up exact facts fast. No narrative. | the surface of `FIELDS-API.md`, `CLIENT-SDK.md`, the `store_*` table listings |
| **Explanation** | Build understanding — the "why", the tradeoffs, the rejected alternatives. | `MISSION.md`, `ARCHITECTURE.md`, package `DESIGN.md` files |

The numbered subsystem docs (`CORE-DOCUMENT-STORAGE`, `DOCUMENT-PATHS`, `RELATIONSHIPS`, …) are deliberately **reference + explanation hybrids**. That's allowed — but section them so the two stay separate: an explanation part ("how it works and why") and a reference part ("the exact surface"). Do not answer a "why" question in the middle of a lookup table, or drop an API signature into a paragraph of rationale.

If you can't name the type in one word, the doc isn't scoped yet. Split it.

## Step 2 — Use the skeleton for that type

Every doc, whatever its type, opens with the same house wrapper; the type-specific skeleton is the body that follows it.

### House format (every doc)

Docs under `docs/` are processed by an import pipeline, so the top of the file is not free-form:

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

- `title`, `path`, and `summary` are required.
- The front-matter `title` and the first H1 text must match **exactly**. The pipeline strips the first H1 and substitutes the front-matter title, so a mismatch silently changes the rendered heading.
- `Companions:` goes immediately below the H1. Relative links only, each with a one-line reason. Include a doc only if it's a genuine prerequisite, an adjacent concept, or a more detailed contract — and link it rather than repeating its explanation.

In the skeletons below, the `# <Title>` line is this same H1, sitting under the front matter.

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

## Step 3 — Apply the universal bar (every type)

These are the things the current docs most often miss. Non-negotiable.

- **Orientation in the first two sentences.** What is this, who is it for, where does it sit? A reader who lands here from a search result must not have to reverse-engineer the context. This is the single most common failure — fix it first.
- **Define before use.** The first time a doc uses a Byline term — `store_*` typed tables, `DocumentPatch`, `ReadContext`, the relation envelope, `useAsPath`, `defineAdmin`, the `beforeRead`/`beforeStore`/`afterStore` hooks — define it in a clause or link to the doc that does. Never assume the reader arrived via the doc that would have defined it.
- **Show, don't paraphrase.** If a point can be made in code, make it in code. Examples must be real (actual Byline APIs and types), complete (copy-paste-able, imports included where they matter), and minimal (nothing incidental). A toy example that doesn't reflect real usage is worse than none — it teaches the wrong shape.
- **Be honest about shipped vs deferred.** Keep the existing convention of naming what's implemented and what's a future phase. Never document aspirational API as if it exists.
- **Cross-link.** Every term you *don't* define here should link to the doc that does. Docs are a graph, not a pile.
- **One concept per section.** If a heading covers two ideas, split it.

## Voice

Plainer than the README. The README is allowed marketing energy — slogans, "foot-gun protection", the three-pillars framing. Docs are not. A doc describes what the system does, directly, for a developer evaluating or learning Byline. No metaphors, slogans, compressed fragments, or rhetorical flourishes, and nothing that asks the reader to infer unstated context.

- **Do:** write clear, grammatically complete sentences; name concrete subjects — "Byline's admin UI", "the server", "the Postgres adapter" — not vague shorthand like "the admin"; state limitations plainly; use active voice; reach for a small table or example when it makes a distinction easier to scan.
- **Don't:** "simply", "just", "easy", "powerful", "seamless"; marketing adjectives; metaphors and slogans; hedging ("it might be possible to perhaps…"); undefined acronyms; a wall of prose where a list or code block is clearer.
- **Plain English must not weaken the contract.** Simplify the wording, never the meaning: keep the precise limits, boundaries, and technical qualifications intact. A doc that reads easily but softens a guarantee is wrong.

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
9. **Broken front matter** — missing `title`/`path`/`summary`, or a front-matter `title` that doesn't match the first H1 (the pipeline will silently override the heading).

## Worked example

**Weak (assertion without code, jargon undefined):**
> Documents are addressed by a path notation and flattened into the typed store tables. The path is derived via `useAsPath` and slugified.

**First-class (orients, defines, shows):**
> A document's **path** is its stable, human-readable address — the slug you'd put in a URL, e.g. `blog/hello-world`. Paths live in their own table, `byline_document_paths`, keyed by `(document_id, locale)`, so a document can carry one path per locale. You choose which field drives the path with `useAsPath`; Byline slugifies that field's value on save.
>
> ```ts
> // Collection definition — the `title` field drives the path.
> defineCollection({
>   name: 'articles',
>   fields: [
>     text({ name: 'title', useAsPath: true }),
>     richtext({ name: 'body' }),
>   ],
> })
>
> // Saving { title: "Hello, World!" } yields a row in byline_document_paths:
> //   document_id  locale  path
> //   <uuidv7>     en      hello-world
> ```
>
> Per-locale paths (a different slug for each translation) are a future phase — today the slugifier runs once per locale off the same source field. See [RELATIONSHIPS.md](./RELATIONSHIPS.md) for how paths resolve across linked documents.

(The exact API above is illustrative — use the real current surface when you write.)

## Self-check before finishing

Run this against the draft. If any answer is "no", fix it before delivering.

- [ ] Can a stranger tell what this is and whether it's for them from the first two sentences?
- [ ] Is the doc exactly one type (or a hybrid with cleanly separated reference/explanation sections)?
- [ ] Is every Byline term defined or linked on first use?
- [ ] Does every "you can do X" claim have runnable, real-API code next to it?
- [ ] Are shipped vs deferred features clearly distinguished?
- [ ] Is the voice plain and direct — no slogans, metaphors, or filler words — while keeping every technical qualification intact?
- [ ] Does the front matter carry `title`/`path`/`summary`, with `title` matching the first H1 exactly?
- [ ] Are code symbols, paths, commands, limits, and behavioural claims verified against the current repo, not memory?
- [ ] Would this doc, as written, actually let someone *do the thing* without opening the source?

The `/document` command runs `pnpm docs:check` as a final mechanical gate — the draft should pass it clean.

## Gold-standard exemplars

*(none yet — highest-leverage addition to this skill)*

Once one doc is rewritten to the bar you want, list it here and tell the skill to match it. A single concrete exemplar calibrates tone and depth better than any rule above. Until then, the rules and the worked example carry the standard.
