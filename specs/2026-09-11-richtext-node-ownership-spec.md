---
title: "Richtext extension node ownership — specification"
path: "richtext-node-ownership-spec"
summary: "Make a Lexical field's resolved editor decide which structures the field accepts, not merely which controls it offers, and adapt existing content on editor load instead of failing."
---

# Richtext extension node ownership — specification

Companions:

- [Collections and fields](../docs/04-collections/index.md) describes how a field's admin configuration reaches the editor.
- [Testing](../docs/13-testing.md) describes the repository's verification workflow.
- [Implementation plan](./2026-09-11-richtext-node-ownership-plan.md) sequences implementation and verification of this specification.

Date: 2026-09-11. Status: approved for planning following user review. Implementation has not started. Target release: 6.0, because the configuration change is a clean break.

## Purpose and scope

A Lexical field in Byline is configured by an extensions list. You remove a feature with `lexicalEditor((c) => c.extensions.remove(builtInExtensions.Table))`, and the editor stops offering it. This specification makes that removal also decide what the field **accepts** — today it does not, and a field configured without headings still stores headings that arrive by paste.

The scope is structural content: which node types a field registers, which Markdown transformers run, which controls appear, and how a field opens a document containing a structure it no longer supports. Formatting that shares `TextNode` — bold, italic, inline code — is explicitly outside this scope and cannot be constrained by this work. Single-line field behaviour, the `DOMImportExtension` rules pipeline, and a general-purpose content conversion framework are also out of scope.

## The defect

`packages/richtext-lexical/src/field/editor-context.tsx` builds the editor's root extension with `nodes: [...Nodes]`, a fixed array of twenty node classes in `src/field/nodes/index.ts`. It is registered in full regardless of which extensions are present, and no configuration path reaches it. Node registration is therefore independent of the extensions list.

This was verified rather than inferred. With all fourteen entries of `builtInExtensions` removed, the editor still reports `HeadingNode`, `TableNode` and `LinkNode` as registered, and HTML containing `<h1>` still parses to a `heading` node. Downstream, a field configured for inline-only titles stored a pasted `heading` with `tag: "h1"`, which the site's serializer rendered as `<h1>` nested inside `<h3>`.

Removing the blanket list corrects this. The same configuration then parses `<h1>` to a paragraph and keeps the text. Three node classes lose their only registration when the list is removed and need a new owner: `HeadingNode`, `MarkNode` and `OverflowNode`. Table, list, link, horizontal-rule and code nodes already resolve through extension dependencies.

Correcting the registry is sufficient only for the structural paste conversions measured in this specification. It is not sufficient for the editor as a whole, and two further gaps were found during verification. `registerMarkdownShortcuts` throws `MarkdownShortcuts: missing dependency table for transformer` when a transformer's node class is absent, so removing the table extension would break the entire Markdown pipeline rather than only tables. Creating an unregistered node throws `Attempted to create node HeadingNode that was not configured to be used on the editor`, so a visible control for a disabled structure is a crash rather than a cosmetic inconsistency. Deriving controls from capabilities is therefore a correctness requirement.

## Decisions

Byline does not adopt `@lexical/rich-text`'s `RichTextExtension` for heading and quote ownership. That extension binds `nodes: () => [HeadingNode, QuoteNode]` to general rich-text behaviour, so adopting it would register headings in every rich-text field and reproduce the defect. Verification confirmed that `registerRichText` works normally with heading and quote unregistered, and that separate Byline-authored extensions give independent, removable ownership.

The extensions list is the capability model for optional features, and Byline does not add a parallel capability enumeration. Three statements make that precise, because the configuration list alone is not the whole picture:

- `editorConfig.extensions` controls **optional features**. It is what a site adds to, removes from, and reorders.
- The **resolved editor's registered node types** determine what structures the field can accept. That is the configured features plus everything they pull in transitively — table and list nodes arrive through `@lexical/table` and `@lexical/list` dependencies rather than appearing in the list — plus mandatory infrastructure.
- `CoreNodesExtension` supplies Byline's mandatory `MarkNode` and `OverflowNode`. The editor root injects it outside `editorConfig.extensions`, so it cannot be removed. Lexical itself does the same for its own core nodes, which are likewise absent from the list.

Everything that asks "what does this field support" therefore reads the resolved editor, never the configuration list. That is also why the scanner's capability manifest is generated from built editors rather than by inspecting configuration.

Controls and Markdown transformers follow **resolved** capabilities — the node classes actually registered on the editor, including those contributed by extension dependencies — not whether a particular Byline extension appears directly in the list. Table and list nodes arrive through `@lexical/table` and `@lexical/list` dependencies, so a membership test would be wrong for exactly those cases.

The plain-text path remains a mode setting rather than an extension. Because Byline does not adopt `RichTextExtension`, its `conflictsWith: ['@lexical/plain-text']` declaration never applies.

The configuration change is a clean break in 6.0 with no deprecated alias. Two supported configuration shapes and their precedence rules would obscure the model at the moment it is being clarified. The downstream footprint is two production sites.

## The paste path this fix depends on

This work is only sufficient for structural content because Byline is still on Lexical's legacy paste path, so that path is a load-bearing assumption rather than an incidental detail.

In `@lexical/clipboard` 0.50 the default `text/html` handler calls `$generateNodesFromDOM`, which walks the static `importDOM()` of each **registered** node class. `ClipboardDOMImportExtension`, which would route pastes through `DOMImportExtension` rules instead, is opt-in and is not wired up. Node registration is therefore the paste control surface today, and every measurement in this specification was taken against that path.

Two consequences follow. Byline must not wire up the rules pipeline as a side effect of this work, because a second import path would decide admissibility by rules rather than by registration and silently weaken the guarantee. And declining to adopt `RichTextExtension` helps here as well as with node ownership: that extension depends on `CoreImportExtension` and on `DOMImportExtension` configured with `RichTextImportRules`, so adopting it would begin assembling the alternative pipeline in the graph.

Clipboard handlers are tried in MIME-type priority order, and `application/x-lexical-editor` runs first at priority 0, ahead of `text/html` at 10. That branch does not use `importDOM` at all: it calls `$generateNodesFromSerializedNodes`, which calls the same `$parseSerializedNode` that throws on an unregistered type. Because Byline gives every field the same `LexicalRichText` namespace, a copy between two Byline fields matches the namespace check and takes this branch.

Measured behaviour for copying a heading into a field that no longer supports headings: the Lexical branch throws internally, `$defaultLexicalEditorImporter` catches it, logs `parseEditorState: type "heading" + not found` through `console.error`, and returns `$next()`. The `text/html` handler then degrades the content exactly as a foreign paste would. The paste does not throw out to the application, nothing is inserted twice, and the text survives — a heading pasted this way arrives as a paragraph reading "Copied title".

The residual defect is noise: each such paste writes a console error that describes an internal fallthrough rather than a fault. Byline does not suppress it, because the handler belongs to `@lexical/clipboard`, but the verification suite asserts the fallthrough so a future Lexical change that turns this into a hard failure is caught.

The guarantee must not depend on HTML being on the clipboard, because a source application may offer only Lexical JSON and plain text. That case was measured: with `text/html` absent, the Lexical branch fails as before and the `text/plain` handler completes the paste, so the text survives and nothing throws. Inline formatting is lost on this route, because plain text carries none; text preservation is the guarantee, formatting is not. The verification suite covers this clipboard shape explicitly.

## Capability and preference model

`EditorSettings` separates what a field supports from how its interface looks.

```ts
export interface EditorSettings {
  mode: 'richText' | 'plainText'
  markdownShortcuts: boolean
  controls: {
    blockFormat: boolean
    inlineCode: boolean
    undoRedo: boolean
    textAlignment: boolean
    markdownToggle: boolean
    treeView: boolean
  }
  inlineImageUploadCollection: string
  placeholderText: string
  debug: boolean
}
```

Everything under `controls` hides an affordance and nothing else. The type documentation must say so explicitly for `inlineCode`: it removes the button, and it cannot prevent inline code arriving by paste, because inline code is a `TextNode` format rather than a node type. No capability exists for bold or italic, so the model cannot imply one.

The mapping from the current `options` record is `richText` to `mode`, `markdownShortcutPlugin` to `markdownShortcuts`, `showTreeView` to `controls.treeView`, `textStyle` to `controls.blockFormat`, and `inlineCode`, `undoRedo`, `textAlignment` and `markdownToggle` to their `controls` equivalents. `debug` moves to the top level. Both downstream registrations are updated in the same release.

## Node ownership

Byline adds three extensions. `HeadingExtension` owns `HeadingNode` and `QuoteExtension` owns `QuoteNode`; both are removable and both appear in `builtInExtensions`. `CoreNodesExtension` owns `MarkNode` and `OverflowNode`, is always present, and is not removable, because neither class belongs to a feature a field can turn off.

The root extension in `editor-context.tsx` stops passing `nodes`. `builtInExtensions` gains entries for the list and check-list extensions so downstream code can remove them without importing from `@lexical/list` and taking a direct dependency on a pinned `lexical`. Those two entries do not follow the `@byline/richtext-lexical/*` convention that `built-in-extension-names.test.node.ts` enforces, so the test grows a documented exception group covering names owned by upstream packages.

`Nodes` is retained rather than deleted, renamed to reflect its new and narrower purpose: the vocabulary of node classes Byline can still **read**, used to build the permissive editor that normalization requires. It is no longer a registration list.

## Normalization on editor load

Lexical throws `parseEditorState: type "heading" + not found` when a saved document contains an unregistered type, and the text is unrecoverable. A field would open blank and erroring. Byline therefore adapts such content when the editor loads it.

Normalization is local to editor loading. Stored versions are never rewritten, and `@byline/client` reads, Markdown export and every other consumer see the document exactly as saved. A document is only persisted in its adapted form when an editor saves it, which is the same rule that governs any other edit.

Normalization runs only when a scan of the serialized value finds a node type the editor has not registered.

It converts **only the unsupported nodes**. Byline rewrites the serialized JSON tree in place: a supported node is copied verbatim, byte for byte, and is never re-encoded. An earlier design round-tripped the whole document through HTML, and that was rejected during review because it damages content that never needed converting — a document holding a supported inline image alongside an unsupported heading would lose the image's media relation and its caption, which lives in a nested editor that `exportDOM` does not reach, purely as collateral of converting the heading. No supported structure may be re-encoded to fix an unrelated one.

The rewrite never mutates its input. It builds a new JSON tree, leaving the form's original value and any cached document untouched, so an unsaved edit or a second consumer of the same value cannot observe a half-converted document.

Conversions are explicit and apply only to the known types listed in the table below. Each has a declared rule: an unsupported **element** of a known type is replaced by its own children, normalized recursively, with inline children wrapped in a paragraph and block children lifted in place. That is why a heading becomes a paragraph and a table becomes one paragraph per cell, and why an unsupported layout containing a supported image yields that image untouched rather than destroying it.

Generic child-unwrapping is **not** applied to unknown or custom node types. A node type Byline does not have a declared conversion for — a custom node from a downstream site, or an unsupported inline image or embed — is never guessed at. It takes the read-only fallback below, as does any known conversion that fails at runtime.

Supported nodes are preserved by copying their own properties while their children are still inspected recursively, because a supported parent may contain an unsupported descendant. "Copied verbatim" therefore describes the node's own properties, not a whole subtree waved through unexamined.

Rewriting at the JSON level is also more faithful than the HTML prototype it replaces. Text nodes carry their formats as data, so converting a bold heading to a paragraph preserves the bold exactly, where an HTML round trip would reconstruct it through spans. This was measured: the converted paragraph retained `format: 1` on its text node.

Because the two paths now use different mechanisms, storage and clipboard are no longer identical by construction. The verification suite requires **equivalent structural outcomes and text preservation**, not exact parity: storage conversion deliberately preserves a link URL and an admonition title that clipboard import discards, and that difference is intended.

The editor shows a notice when content was adapted: *"This content contains formatting this editor no longer supports. Saving edits will use the supported formatting."* The notice is not a dialog and does not block editing.

### Verified conversions

These are the required outcomes when a structure is not supported by the field. They were established by measurement against the HTML prototype described above; the shipping mechanism is the JSON rewrite, and the implementation must verify that it reproduces every row, preserving inline text formats that the prototype could only approximate.

| Structure | Result | Text | Verdict |
|---|---|---|---|
| Heading | paragraph | preserved | supported |
| Quote | paragraph | preserved | supported |
| Code block | paragraph | preserved; language lost | supported |
| Table | one paragraph per cell | preserved | supported |
| Layout columns | one paragraph per column | preserved | supported |
| Bullet and check list | one paragraph per item | preserved | supported |
| Horizontal rule | removed | neighbours preserved | supported |
| Link | paragraph text | link text preserved; URL lost | needs treatment |
| Admonition | paragraph | body preserved; title lost | needs treatment |
| Inline image | empty paragraph | image, relation and caption lost | **no conversion** |
| YouTube embed | nothing | everything lost | **no conversion** |
| Vimeo embed | nothing | everything lost | **no conversion** |

Link and admonition must not lose information silently. The link URL is preserved by appending it to the degraded text, and the admonition title is preserved by emitting it as the first line of the resulting paragraph. Both conversions are then verified like the others.

Inline images and embeds have no declared conversion, and no rule guesses one for them. An inline image carries a relation to a media document and a caption held in a nested editor, neither of which survives the HTML round trip; the embeds disappear entirely. Byline therefore does **not** normalize a document containing one of these in a field that no longer supports it. The field opens read-only with an explicit message naming the unsupported content and directing the reader to an administrator. Silently discarding a person's image is worse than refusing to open the field, and the scan script exists so operators meet this case before their users do.

### Persistence

Suppressing `onChange` during normalization is necessary but does not establish safe persistence, so the behaviour is specified by what the form submits:

- Opening a document with adapted content submits nothing and leaves the stored value unchanged.
- Saving an unrelated field submits that field only; the adapted field's stored value is unchanged.
- Editing the adapted field submits its normalized representation. This is expected and is what the notice warns about.
- Restoring an older version behaves like opening it: adaptation is presentational until the reader edits the field.

## Compatibility and the scan script

Byline ships a script that reports which stored documents contain structures a collection's current field configuration no longer supports, distinguishing structures that will be adapted from those that will make a field read-only. Operators run it before upgrading. The two downstream sites are expected to report clean, or nearly so: one archived version of one FORRU document carries a stray heading.

## Verification

Verification is behavioural and asserts on resulting editor state rather than on the presence of controls. Tests run in jsdom, building editors with `buildEditorFromExtensions` and `ReactPluginHostExtension`, which is required for the default extension set because several extensions host React decorators. `@lexical/html` and `@lexical/clipboard` are added as development dependencies of `@byline/richtext-lexical`; neither resolves from the package today.

For a configuration with extensions removed, tests cover HTML paste, Lexical-to-Lexical paste including the fallthrough described above, keyboard commands, Markdown shortcuts, and loading a saved value containing a now-unregistered node. Each asserts that the disabled structure does not appear in the resulting state, that the text survives, and that ordinary editing does not throw. A further test runs the full `defaultExtensionsList()` and asserts that every structure still round-trips, so the default configuration does not regress. The persistence cases above are tested as described, against what the form submits.

`editor-component.test.tsx` contains one failing assertion on `develop` that predates this work. It is unrelated to node ownership and is not repaired here.
