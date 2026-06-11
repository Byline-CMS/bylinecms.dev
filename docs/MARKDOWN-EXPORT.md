---
title: "Markdown Export"
path: "markdown-export"
summary: "The agent-readable surface: one-way Lexical → markdown serialization, the documentToMarkdown assembler, .md routes per content locale, llms.txt, and the three advertisement channels."
---

# Markdown Export

The markdown export surface serves a **markdown representation of every published
document at its canonical URL + `.md`** — `/docs/getting-started.md`,
`/fr/news/foo.md` — plus an `llms.txt` site index ([llmstxt.org](https://llmstxt.org))
linking to those representations. It exists for AI agents and documentation
tooling, which increasingly expect markdown over HTML; it is the cheapest,
most concrete piece of "AI-first" Byline ships.

Three properties define the whole design:

1. **One-way and lossy-tolerant.** The output is read-only and never
   re-imported. Layout columns flatten to stacked sections, video embeds
   become links, underline/highlight inline formats drop. This is *not* the
   editor's markdown source toggle (which needs bidirectional, lossless
   transformers — see [Dialects](#dialects) below).
2. **Published-only, preview-blind.** Every read goes through the *public*
   client with `status: 'published'`. Drafts never leak; editor preview never
   applies to an anonymous, cacheable agent surface (the same contract as the
   sitemap — see the viewer-client header in `@byline/host-tanstack-start`).
3. **The output is a contract surface.** Agents build on the shape, so the
   format is pinned by contract tests in both packages — a change to an
   expected string in those tests is a consumer-visible format change and
   must be deliberate.

## Architecture

```
@byline/richtext-lexical   lexicalToMarkdown(json)            (editor-specific)
        │                        registered via
        ▼
@byline/core               ServerConfig.fields.richText.toMarkdown   (the seam)
        │                        consumed by
        ▼
@byline/core               documentToMarkdown(doc, definition, opts) (schema-aware)
        │                        called from
        ▼
apps/webapp                .md routes · llms.txt · advertisement channels
```

- **`lexicalToMarkdown`** (`packages/richtext-lexical/src/field/markdown/lexical-to-markdown.ts`,
  exported from `@byline/richtext-lexical/server`) walks the **stored**
  `SerializedEditorState` JSON directly — no `@lexical/headless`, no DOM, no
  node registration. `lexicalEditorToMarkdownServer()` is the factory shaped
  for the config slot, the sibling of `lexicalEditorEmbedServer` /
  `lexicalEditorPopulateServer`.
- **The seam** — `ServerConfig.fields.richText.toMarkdown`
  (`RichTextToMarkdownFn`, `packages/core/src/@types/field-types.ts`) — keeps
  `@byline/core` editor-agnostic, exactly like the `embed` / `populate` slots
  beside it. Synchronous and read-only.
- **`documentToMarkdown`** (`packages/core/src/services/document-to-markdown.ts`)
  walks `CollectionDefinition.fields` and the locale-resolved field data in
  lockstep and emits one markdown document. It is pure: the richtext
  serializer and all URL resolution arrive as options (`richTextToMarkdown`,
  `resolveUrl`, `resolveFileUrl`), so routing knowledge never enters core and
  the function unit-tests without `initBylineCore()`.
- **The app layer** (`apps/webapp/src/lib/markdown.ts` + per-collection
  modules) owns loading, caching, URL building, and response shaping.
  Opt-in is by construction: a collection has a markdown surface when the
  app writes a route for it — no schema flag.

## The format contract

### Frontmatter

Flat YAML, fixed key order, strings double-quoted:

| Key | Source | Emitted when |
|---|---|---|
| `title` | the `useAsTitle` field | present |
| `description` | a field named `summary` | present |
| `canonical` | absolute URL of the HTML page | always (routes supply it) |
| `locale` | the content locale of this variant | always |
| `collection` | `definition.path` | always |
| `published` | a field named `publishedOn` | present |
| `updated` | `doc.updatedAt` | present |

### Body rendering rules

- The `useAsTitle` field → `# H1` (never repeated as a section).
- A field named `summary` → an unlabelled lead paragraph (the standfirst).
- `richText` and `blocks` fields render their content **directly, with no
  `## Label` heading** — they *are* the document body. Unknown block types
  are skipped.
- Scalar fields (text, textArea, datetime, select, numbers) →
  `**Label:** value` lines.
- `checkbox` / `boolean` / `json` / `object` render **nothing** — booleans
  are almost always presentation toggles (`constrainedWidth`, `featured`)
  and json is machine-shaped. The export renders *content, not
  configuration*.
- `relation` → `**Label:** [title](url)` when populated and the target has a
  public page (`resolveUrl` returns a URL); plain text when it doesn't
  (e.g. `media`); nothing when unresolved.
- `image` / `file` → `![alt](url)`.
- `group` → `## Label` + nested walk; `array` → `## Label` + items.
- Empty values are skipped entirely — no empty headings.

### Lexical node coverage

Mirrors the render serializer
(`apps/webapp/src/ui/byline/components/richtext-lexical/serialize/`):
paragraph, heading (`tag`), lists (bullet / number / check, nested), quote,
code (+ `code-highlight` / `linebreak` children, fence grows past inner
backtick runs), table (GFM pipes, first row as header), link / autolink
(custom + internal), horizontalrule, linebreak (hard break `\`), text
(format bitmask: bold / italic / strikethrough / inline code; underline,
highlight, sub/superscript drop), admonition, inline-image (+ nested caption
editor flattened to an emphasized line), youtube / vimeo (→ links),
layout-container / layout-item (flattened to stacked sections). Unknown node
types serialize their children and emit a warning — new nodes degrade
gracefully instead of disappearing.

Internal links resolve through the node's embedded document envelope
(`/​{targetCollectionPath}/{document.path}` by default, overridable via
`resolveInternalUrl`); unresolved targets keep their text and drop the link.

### Dialects

Admonitions export as **GFM alerts**: a blockquote whose first line is
`> [!NOTE]` (`note→NOTE, tip→TIP, warning→WARNING, danger→CAUTION`), body as
ordinary blockquote content. GFM alerts carry no title parameter, so the
Byline admonition title renders as a bold lead paragraph:

```markdown
> [!WARNING]
>
> **Careful**
>
> Hot surface.
```

This is a **deliberate asymmetry**: the editor's markdown source toggle
(`BYLINE_TRANSFORMERS`) and the docs importer
(`apps/webapp/byline/scripts/lib/parse-markdown.ts`) speak the Docusaurus
`:::type[Title]` dialect, while the export emits GFM — because GFM alerts
are what GitHub, agents, and most renderers understand. The intended end
state is *two accepted input dialects, one output dialect*: extend
`parse-markdown.ts` to also accept GFM alerts (see
[Future phases](#future-phases)).

### Where the contract is pinned

- `packages/richtext-lexical/src/field/markdown/lexical-to-markdown.test.node.ts`
- `packages/core/src/services/document-to-markdown.test.node.ts`
- `apps/webapp/e2e/markdown.spec.ts`, `apps/webapp/e2e/llms.spec.ts`

## Routes and URL surface

One markdown variant **per content locale**, at the canonical URL + `.md` —
the same cache-key dimension as the HTML page (see CACHING.md):

| URL | Route file | Collection |
|---|---|---|
| `/[lng/]docs/{path}.md` | `$lng/_frontend/docs/{$path}[.]md.ts` | docs |
| `/[lng/]news/{path}.md` | `$lng/_frontend/news/{$path}[.]md.ts` | news |
| `/[lng/]{path}.md` | `$lng/_frontend/{$path}[.]md.ts` | pages (root area) |
| `/[lng/]about/{path}.md` | `$lng/_frontend/about/{$path}[.]md.ts` | pages (`area` guarded) |
| `/[lng/]legal/{path}.md` | `$lng/_frontend/legal/{$path}[.]md.ts` | pages (`area` guarded) |
| `/llms.txt` | `llms[.]txt.ts` (locale-less top level) | all of the above |

Mechanics worth knowing (each cost a spike to learn):

- **Suffixed path params.** `{$path}[.]md` matches `/docs/foo.md` with
  `params.path === 'foo'`. TanStack Router supports `{prefix{$id}suffix}`
  segments (`router-core` `path.d.ts`) even though the docs site barely
  mentions it; ranking correctly prefers it over the sibling `$path.tsx`
  HTML route.
- **The locale rewrite treats `.md` as content, not asset.**
  `isLocalizablePath` (`src/i18n/locale-rewrite.ts`) special-cases the
  `.md` suffix *before* its asset heuristic, so `/news/foo.md` is prefixed
  with the default locale like the HTML page, while `/llms.txt` and
  `/sitemap.xml` stay locale-less. Pinned in `locale-rewrite.test.ts`.
- **Dev-server passthrough.** Vite's dev middlewares claim `.md` requests
  whose `Accept` header is not `text/html` (curl, agents, Playwright — the
  feature's actual consumers) and 404 them as missing static files before
  Start's catch-all runs. `devMarkdownPassthrough` (`vite.config.ts`)
  normalises `Accept` on `.md` GETs in dev only; production has no Vite
  middleware. Without it, dev and prod diverge exactly for agent-shaped
  requests.
- **Routes are pure server handlers** (no component) reaching their handler
  bodies through handler-local dynamic `import()` so the server-only chain
  (Byline SDK, L1 cache → `node:dns`) stays out of the client graph — the
  `sitemap[.]xml.ts` pattern.
- **Pages carry an `area` acceptance guard**: `/legal/x.md` 404s for an
  `about`-area page, mirroring the HTML routes. The canonical segments
  participate in the L1 cache key so two URL shapes for one document can
  never share an entry.

## Advertisement channels

Agents discover the surface through three channels:

1. **The `.md` URL convention** — append `.md` to any document URL.
2. **`<link rel="alternate" type="text/markdown">`** in every detail page's
   head — `getMeta`'s `markdownAlternatePath` option (`src/lib/meta.ts`),
   passed by the five detail routes as `` `${canonical}.md` ``.
3. **`Accept: text/markdown` content negotiation** on canonical HTML URLs —
   a strict 302 in the server entry (`src/lib/markdown-negotiation.ts`,
   wired in `src/server.ts` beside the locale negotiation). Two deliberate
   choices: it is a **redirect, not a 200-with-`Vary`** (two bodies on one
   URL forces every cache layer to key on Accept; one misconfigured layer
   poisons the HTML for browsers — the redirect keeps cache keys distinct),
   and it **never fires for browsers** (only when Accept names
   `text/markdown` and not `text/html`, which browsers always lead with).
   The redirect carries `Cache-Control: no-store`.

## llms.txt and the shared published-URL index

`/llms.txt` emits the llmstxt.org shape — H1 site name, blockquote
description, H2 sections of `- [title](url.md): description` links — with
links pointing at the **markdown representations**, not the HTML.

Both `llms.txt` and `sitemap.xml` consume the same per-collection
published-URL enumeration (`apps/webapp/src/lib/published-index.ts`): one
scan per collection, one L1 cache entry (the sitemap keys/tags), so the two
agent-facing surfaces structurally cannot drift. The sitemap maps entries to
`<url>` + hreflang; `llms.txt` maps them to `.md` links with titles and
descriptions.

## Caching and invalidation

- **L1**: serialized markdown is cached per `(collection, path, locale, URL
  shape)` tagged with the document's **detail tag** — so the collection
  hooks' per-document invalidation sweeps `.md` variants on every edit
  alongside the HTML reads, with zero extra wiring. The published-index
  scans carry the sitemap tags and are swept on structural changes
  (create / publish / unpublish / delete). See DATA-CACHE-DESIGN.md
  (`apps/webapp/docs/`).
- **HTTP**: `.md` responses send the same posture as HTML pages
  (`s-maxage=60, stale-while-revalidate=86400`); `llms.txt` matches the
  sitemap (`s-maxage=600`).

## Explicitly not

- **Not the editor's markdown source toggle.** That needs bidirectional,
  lossless transformers running inside a Lexical editor
  (`BYLINE_TRANSFORMERS`); the export is a one-way tree walk with a lower
  fidelity bar. Don't let the toggle's requirements gate export changes, or
  vice versa.
- **Not re-importable.** `import-docs.ts` consumes authored markdown, not
  export output.
- **Not the stable HTTP API.** The `.md` routes are app-owned representations
  of published documents, not a transport boundary (see ROUTING-API.md).

## Future phases

### Phase — docs-corpus round-trip test

**Trigger:** can land any time; highest value before the next Lexical
version bump. `import(export(import(md))) ≅ import(md)` over the repo's
`docs/*.md` corpus, comparing **Lexical trees** rather than strings (so
cosmetic marker/escaping differences don't fail). The subject under test is
the *export* serializer against real production-shaped content — the import
pipeline (`byline/scripts/lib/`) is the vehicle. Preferred companion change:
extend `parse-markdown.ts` to also **accept** GFM alerts, erasing the
admonition dialect asymmetry and making the round-trip exact.

### Phase — per-field markdown opt-out

**Trigger:** real noise complaints about config-flavoured scalars in the
output (e.g. a block's `display` select rendering as `**Display:** default`).
The likely shape: a `markdown: false` flag on field definitions consulted by
`documentToMarkdown`. Booleans/json are already excluded wholesale; hold off
until a concrete case shows the per-field flag is needed.

### Phase — host-package route factories

**Trigger:** a second host app (or the CLI installer) wants the `.md` surface
without hand-writing routes. Promote the generic loader
(`apps/webapp/src/lib/markdown.ts`) and route shape into
`@byline/host-tanstack-start` factories, the way the admin routes are
factory-built today.

### Phase — `llms-full.txt` and MCP

**Trigger:** an agent integration that wants the full corpus in one fetch
(`llms-full.txt` is a cheap concatenation once per-document serialization
exists), and the MCP server (see MCP.md), whose content tools should serve
these same representations.
