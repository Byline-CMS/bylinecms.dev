---
title: "Richtext field capabilities"
path: "richtext-capabilities"
summary: "How a Lexical field decides which structures it accepts, how that differs from which controls it shows, and what happens to stored content a field no longer supports."
---

# Richtext field capabilities

Companions:
- [Fields](../04-collections/01-fields.md) — how a `richText` field is declared on the schema side and configured on the admin side.
- [Admin-config registration](./02-admin-config-registration.md) — how the admin and editor configuration reaches the browser, and why it is code-split away from public routes.
- [Admin interface i18n](../08-internationalization/index.md) — the translation system the editor's notices use.

A richtext field in Byline is a Lexical editor configured by a list of extensions. Read this document when you are narrowing a field — a title that should hold no headings, a caption that should hold no tables — or when you need to know what will happen to documents already written under a wider configuration.

Two decisions look similar and are not. **Capabilities** are the structures a field accepts: whether a heading can exist in it at all, however it arrives. **Controls** are the buttons and menus the editing surface shows. Removing a control hides an affordance; it does not stop content arriving by paste, by Markdown, or from storage.

## Overview

Three rules anchor the model.

1. **`editorConfig.extensions` controls optional features.** It is the list a site adds to, removes from, and reorders.
2. **The resolved editor's registered node types decide what the field accepts.** That is the configured extensions, plus everything they pull in transitively, plus mandatory infrastructure. It is not the same as the configuration list: table and list nodes arrive through `@lexical/table` and `@lexical/list` as dependencies of Byline's wrappers, and never appear in the list themselves.
3. **`settings.controls` decides only what the interface shows.** No flag there restricts content.

Each extension owns the node classes for its feature, so removing an extension removes its controls, its behaviour **and** its node registration together. A node class that is not registered cannot be created by a command, cannot be produced by a Markdown shortcut, and cannot survive a paste.

```ts
import { builtInExtensions, lexicalEditor } from '@byline/richtext-lexical/config'

// A title field that accepts inline formatting and nothing structural.
export const TitleEditor = lexicalEditor((c) => {
  c.extensions
    .remove(builtInExtensions.Heading)
    .remove(builtInExtensions.Quote)
    .remove(builtInExtensions.List)
    .remove(builtInExtensions.CheckList)
    .remove(builtInExtensions.Table)
  return c
})
```

Paste a heading into a field configured that way and it arrives as a paragraph with its text intact.

### What capabilities cannot constrain

Bold, italic and inline code are `TextNode` formats rather than node types. They have no node class to unregister, so they still arrive by paste no matter how a field is configured. `controls.inlineCode` hides the button and nothing more.

Line breaks and paragraph structure are likewise governed by Lexical's own import rules rather than by node registration. Constraining them needs the `DOMImportExtension` rules pipeline, which Byline does not currently wire up.

---

## Quick reference

### Stop a field accepting a structure

Remove the extension that owns it, through a client-side wrapper registered on `FieldAdminConfig.editor`.

**Edit:** your field's admin config, for example `apps/webapp/byline/fields/richtext/lexical-richtext-minimal-admin.tsx`.

Extension references are not JSON-safe, so they cannot be baked into a schema. A schema-side `editorConfig` carries settings only.

### Hide a control without disabling the feature

Set the flag on `settings.controls`. The field still accepts the structure; the button is gone.

**Edit:** your schema-side field helper, for example `lexicalRichTextCompact()`.

```ts
config.settings.controls.undoRedo = false // keyboard undo still works
```

### Find out what existing documents will do

Generate a capability manifest, then scan stored documents against it. See [Checking existing content](#checking-existing-content).

---

## Extensions and the nodes they own

| Extension | Node types |
|---|---|
| `Heading` | `heading` |
| `Quote` | `quote` |
| `List`, `CheckList` | `list`, `listitem` |
| `Table` | `table`, `tablerow`, `tablecell` |
| `CodeHighlight` | `code`, `code-highlight` |
| `Link`, `AutoLink` | `link`, `autolink` |
| `HorizontalRule` | `horizontalrule` |
| `Admonition` | `admonition` |
| `Layout` | `layout-container`, `layout-item` |
| `InlineImage` | `inline-image` |
| `YouTube`, `Vimeo` | `youtube`, `vimeo` |

`CoreNodesExtension` owns `mark` and `overflow`. It is injected by the editor root rather than carried in the configurable list, because neither class belongs to a feature a field can switch off. It is deliberately absent from `builtInExtensions` and cannot be removed.

Removing `CheckList` alone leaves `list` and `listitem` registered, because `ListExtension` owns those node classes. The check-list control disappears; bulleted and numbered lists remain.

## Stored content a field no longer supports

Narrowing a field does not rewrite anything already stored. Lexical throws when asked to load a node type an editor has not registered, so without intervention a field whose configuration narrowed would open blank and erroring on an older document.

Byline adapts such content when the editor loads it. Three properties govern this:

- **Only unsupported nodes are converted.** A supported node keeps its own properties untouched while its children are still inspected, because a supported parent may hold an unsupported descendant.
- **Nothing is guessed at.** A node type with no declared conversion — an image, an embed, or a custom node from your own extension — is never restructured.
- **Adaptation is presentational.** Stored versions are never rewritten. `@byline/client` reads, Markdown export and every other consumer see the document exactly as saved. The adapted form reaches storage only if an editor saves an edit to that field.

### Declared conversions

| Structure | Becomes | Preserved |
|---|---|---|
| Heading, quote, code block, list item | one paragraph each | text and inline formats |
| Table, list, layout | one paragraph per cell, item or column | text |
| Admonition | paragraphs | body text, with the title as the first line |
| Link, auto-link | inline text | link text, with the URL appended |
| Highlighted code token | plain text | text and inline formats |
| Horizontal rule | removed | neighbouring blocks |

Adjacent blocks stay separate, and an empty block stays an empty line. When conversion removes everything, the field receives an empty paragraph, because Lexical rejects an empty document root.

The editor shows an inline notice when content was adapted, and the field stays editable:

> This content contains formatting this editor no longer supports. Saving edits will use the supported formatting.

### Content with no conversion

An inline image carries a relation to a media document and a caption held in a nested editor; an embed carries its video identity. No structural rewrite preserves either, so Byline does not attempt one. The field opens **read-only**, names the content, and directs the reader to an administrator. Nothing is discarded.

A node type Byline does not recognise takes the same path. That includes a node contributed by your own extension: it needs no registration with Byline to be handled safely, and the notice names it by its type id.

## Checking existing content

Before narrowing a field on a live installation, check what the change will do to documents already written. The check runs in two steps, because capabilities and content are established differently: measuring what a field accepts means building its editor, which needs a DOM and a React-capable module graph, while scanning stored values needs a database connection. A manifest file travels between them.

**1. Generate the manifest.**

```sh
cd apps/webapp && pnpm byline:richtext-manifest
```

This mounts every richtext field's editor in jsdom, records the node types each one registered, and writes `byline/generated/richtext-capabilities.json`. It needs no browser and no running application, and it is what CI runs — so the same command works against a production configuration.

The file is a per-installation artifact, specific to your field configuration and stale as soon as a field is reconfigured. It is not committed, and `byline/generated/` holds no example to compare against: generate one when you need it.

There is also an interactive equivalent at `/admin/richtext-capabilities`, which shows each field, the editor it resolved to, and the resulting manifest to copy or download. It is useful for seeing *why* a field measured as it did. It is served only in development, so it is not the path to use when checking a production installation.

Both read and write no content.

**2. Scan stored values.**

```sh
cd apps/webapp && pnpm tsx byline/scripts/richtext-scan.ts
```

The script reads every value in `byline_store_json` — every document, every version including archived ones, every locale — matches each against the manifest, and reports per collection:

```text
  pages
    content.photoBlock.caption [fr]  doc 019f70…  version 019f70…
      adapts: heading
    content.richTextBlock.richText [en]  doc 019f70…  version 019f70…
      read-only: inline-image

Will adapt on open:     6
Will open read-only:    44
Capabilities unknown:   0
```

It exits non-zero when any value would make a field read-only, **or** when any field's capabilities could not be measured, so it can gate a deployment.

A field whose capabilities are unknown is reported as `capabilities unknown — not examined`, never counted as clean. Reporting a document safe when it was never looked at is the one failure an upgrade check must not have. The script also lists stored field paths with no manifest entry: those are ordinary `json` fields, or the manifest is stale and needs regenerating.

Stored values are addressed by instance path — `content.1.photoBlock.caption`, carrying the item index — while the manifest is keyed by declaration path. The script elides the selectors to match them, so a field nested in a block, or in an array inside a block, is covered without extra configuration. See [Path grammar](../03-architecture/04-path-grammar.md) for the two notations.

### Using the APIs directly

Both halves are exported for hosts that need their own workflow. `@byline/richtext-lexical/scan` is runtime-free — no React, no Lexical, no CSS — so a Node script can import it; measuring capabilities lives on the root entry and needs a DOM.

```ts
import { buildManifest, capabilitiesFor } from '@byline/richtext-lexical'
import { scanDocument, summarise } from '@byline/richtext-lexical/scan'

// In a browser or jsdom: measure what each field accepts.
const manifest = buildManifest([capabilitiesFor('publications', 'title', editorConfig)])

// In Node, against stored values: report what each will do.
const finding = scanDocument(storedValue, manifest.fields[0], {
  documentId: doc.id,
  versionId: version.id,
})
```

`scanDocument` returns `undefined` when a value needs no adaptation. Otherwise it reports `adaptedTypes`, `refusedTypes`, or `unmapped: true` when the field's capabilities were never measured. `summarise()` splits a list of findings into those three groups.

Capabilities are measured by building the editor rather than by inspecting the configuration list, so the report cannot disagree with the runtime it predicts.

## Upgrading from 5.x

Two separate things changed in 6.0, and they need different responses.

### The configuration API changed

`EditorSettings.options` is replaced, with no alias. Every registration must move:

| 5.x | 6.0 |
|---|---|
| `options.richText` | `mode: 'richText' \| 'plainText'` |
| `options.markdownShortcutPlugin` | `markdownShortcuts` |
| `options.showTreeView` | `controls.treeView` |
| `options.textStyle` | `controls.blockFormat` |
| `options.inlineCode` | `controls.inlineCode` |
| `options.undoRedo` | `controls.undoRedo` |
| `options.textAlignment` | `controls.textAlignment` |
| `options.markdownToggle` | `controls.markdownToggle` |
| `options.debug` | `debug` |

`Nodes` is renamed `READABLE_NODES` and is no longer a registration list.

Where a registration used `textStyle: false` to mean "no headings", that intent now belongs in the extensions list — `c.extensions.remove(builtInExtensions.Heading)` — because the flag only ever hid the dropdown. Read each call site and decide which was meant: hiding the control, disabling the capability, or both. That decision is the substance of the upgrade, not the rename.

### What a field accepts changed

This is the part to check against real content. Removing an extension now removes its node registration, so a field narrowed in 5.x — where narrowing only hid controls — may hold content it no longer accepts.

Nothing on disk changes at upgrade time. A document written under a wider configuration is adapted when an editor opens it, or the field opens read-only if it holds something with no safe conversion. **Stored values change only when that field is edited and saved.** Reads through `@byline/client`, Markdown export and every other consumer are unaffected either way.

So the risk is not data loss on upgrade. It is an editor meeting an adapted or read-only field without warning. Find those first:

```sh
cd apps/webapp
pnpm byline:richtext-manifest          # measures every field; no browser needed
pnpm tsx byline/scripts/richtext-scan.ts
```

See [Checking existing content](#checking-existing-content) for what each step does and for the interactive alternative.

The scan is read-only. It exits non-zero if any value would open read-only, or if any field's capabilities could not be measured — so a zero exit means nothing will be refused and nothing went unexamined. It does **not** mean nothing will change: adaptations are reported and still exit zero, because adapting is the designed outcome rather than a failure. Read the counts, not just the exit status. Zero findings altogether is what means no editor will meet either notice.

If the scan reports content that will open read-only, restore the extension that owns it for that field, or migrate the content, before deploying.

## Not yet shipped

- **Format-level restriction.** Bold, italic and inline code cannot be constrained, as described above. Doing so requires the `DOMImportExtension` rules pipeline, which Byline does not wire up.
- **Single-line fields.** Removing structural extensions does not by itself produce a single-line editor. Paragraph handling, Enter behaviour and paste shaping all need explicit constraints.
- **Exhaustive refusal reporting.** When a document is refused, the notice names the outermost unsupported type. A custom node wrapping an embed reports the custom node alone.
