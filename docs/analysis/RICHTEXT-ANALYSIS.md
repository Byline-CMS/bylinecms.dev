# Richtext Editor Adapter — Analysis

> Last updated: 2026-04-29 (Phase 1 — `@byline/richtext-lexical` extracted, single-slot adapter shipped; Phase 1.5 — opaque per-field `editorConfig` and `lexicalEditor()` factory shipped same day)
> Companions:
> - [CORE-COMPOSITION-ANALYSIS.md](./CORE-COMPOSITION-ANALYSIS.md) — the broader story for how Byline composes adapter packages (db, storage, session, and now editors).
> - [RELATIONSHIPS-ANALYSIS.md](./RELATIONSHIPS-ANALYSIS.md) — the richtext editor's link and inline-image plugins are the first non-form consumer of the populate pipeline; future editor work will continue to lean on the relation field surface.

This document captures the deliberately small first step we took on richtext editor pluggability and the larger surface we **chose not to build yet**. The point of recording the deferred surface here is so the project does not drift into a Payload-shaped adapter by accident, one feature at a time, before a second editor package or a real divergence forces the design.

## Context

Until 2026-04-29, the Lexical editor lived inside `@byline/ui` at `packages/ui/src/fields/richtext/richtext-lexical/`, and `packages/ui/src/fields/field-renderer.tsx` imported `RichTextField` directly. Every Byline consumer therefore shipped Lexical and every Lexical plugin we bundled, and there was no way to substitute another editor (TipTap, ProseMirror, a markdown editor, a code editor) without forking the renderer.

Phase 1 (this commit window):

- The Lexical implementation moved wholesale into a new package, `@byline/richtext-lexical`, built with the same Rslib + tsconfig template as `@byline/ui`.
- A typed `RichTextEditorComponent` contract lives in `@byline/core` (`packages/core/src/@types/field-types.ts`).
- A single optional slot, `ClientConfig.fields.richText.editor`, was added to `packages/core/src/@types/site-config.ts`.
- The webapp's `byline.admin.config.ts` registers `@byline/richtext-lexical`'s `RichTextField` as the site-wide editor.
- `packages/ui/src/fields/field-renderer.tsx` reads the configured editor at render time and throws an actionable error when a `richText` field is rendered with no editor registered.
- Per-field `FieldComponentSlots.Field` overrides keep precedence over the site-wide default — no new override mechanism was introduced.

That is the entire surface today. It satisfies the immediate need ("tell Byline which editor to use"), it stays consistent with the existing client-side UI extensibility pattern (config-object, no new DI container), and it leaves the package boundary clean enough that `@byline/ui` no longer depends on Lexical at all.

## Framing

Payload CMS has a substantial editor adapter API: editors register their own lifecycle hooks (`beforeChange`, `afterChange`, `beforeRead`, `serialize`, `deserialize`), a feature graph that toggles plugins on/off and registers custom features, and a runtime that orchestrates the hooks alongside the rest of the field lifecycle. It is a powerful surface, but it is also a meaningful design commitment — and one that is much easier to *shape* against multiple real editor implementations than to *guess* against one.

Byline's V1 adapter intentionally inverts that order. We extracted the package boundary first; we will only grow the contract when a second editor package or a real product requirement forces a specific shape. The risk of staying small here is low (the contract can be extended), and the cost of overshooting is real (a broad adapter shape locked in around the quirks of one editor).

## What shipped

### The contract

```ts
// packages/core/src/@types/field-types.ts

export interface RichTextEditorProps {
  field: RichTextField
  defaultValue?: unknown
  onChange: (value: unknown) => void
  path: string
  instanceKey: string
  locale?: string
}

export type RichTextEditorComponent = SlotComponent<RichTextEditorProps>
```

The shape mirrors what the field-renderer was already passing for `type: 'richText'` fields, so the move was a typed-boundary change only — neither the renderer nor the Lexical wrapper needed behavioural changes.

### The slot

```ts
// packages/core/src/@types/site-config.ts (excerpt)

export interface ClientConfig extends BaseConfig {
  admin?: CollectionAdminConfig[]
  fields?: {
    richText?: { editor: RichTextEditorComponent }
  }
}
```

`fields` is namespaced rather than flat so additional field-level defaults (custom widgets, formatters, etc.) can be registered there as the system grows, without each one having to negotiate a top-level config key.

### Registration

```ts
// apps/webapp/byline.admin.config.ts (excerpt)

import { RichTextField as LexicalRichTextField } from '@byline/richtext-lexical'

defineClientConfig({
  // ...
  fields: {
    richText: { editor: LexicalRichTextField },
  },
})
```

`@byline/richtext-lexical` exports `RichTextField` as the component matching `RichTextEditorComponent`. Alternative editor packages (e.g. a future `@byline/richtext-tiptap`) only need to export a component matching the same contract.

### Renderer behaviour

`packages/ui/src/fields/field-renderer.tsx` reads the configured editor at render time:

```tsx
case 'richText': {
  const RichTextEditor = getClientConfig().fields?.richText?.editor
  if (!RichTextEditor) {
    throw new Error(
      'No richText editor registered. Install @byline/richtext-lexical and set ' +
        '`fields.richText.editor` in your admin config (byline.admin.config.ts).'
    )
  }
  return (
    <RichTextEditor
      field={hideLabel ? { ...field, label: undefined } : field}
      defaultValue={defaultValue}
      onChange={handleChange}
      path={path}
      instanceKey={htmlId}
      locale={isLocalised ? contentLocale : undefined}
    />
  )
}
```

The throw is the failure mode by design. A `richText` field with no editor configured is unusable; we want loud, fast feedback at first render rather than a silent textarea fallback that could ship to production unnoticed.

## Phase 1.5 — Opaque per-field config and a registration factory

Shipped the same day as Phase 1, in response to the immediate practical need to (a) configure the registered editor with site-wide settings and (b) reduce the feature set on a per-field basis (caption fields, byline strap-lines, anywhere the full editor surface is inappropriate).

The shape is intentionally minimal — three tiny additions, none of which commit `@byline/core` to a feature graph or adapter pipeline. The contract `RichTextEditorComponent` is unchanged.

### What was added

1. **Schema-level slot — `RichTextField.editorConfig?: unknown`** in `packages/core/src/@types/field-types.ts`. The shape is opaque to `@byline/core`: each editor adapter defines what it accepts. For `@byline/richtext-lexical` this is the package's `EditorConfig`. The value flows from the schema through the renderer (which already passes the field definition) into the editor wrapper.

2. **Field-level priority in the wrapper** — `packages/richtext-lexical/src/richtext-field.tsx` resolves the editor config in this order:
   1. `field.editorConfig` (most specific — the schema author opted in for this field),
   2. `editorConfig` prop (registration-baked via `lexicalEditor()`),
   3. `defaultEditorConfig` (package fallback).

3. **Registration factory — `lexicalEditor(configure?)`** in `packages/richtext-lexical/src/lexical-editor.tsx`. Returns a `RichTextEditorComponent` with editor settings baked in via a closure. The `configure` callback receives a `cloneDeep(defaultEditorConfig)` so mutating it is safe and never leaks across registrations. `lexicalEditor()` with no argument is equivalent to registering `RichTextField` directly.

### Two usage shapes

Site-wide reduced editor — registration site:

```ts
// apps/webapp/byline.admin.config.ts
import { lexicalEditor } from '@byline/richtext-lexical'

defineClientConfig({
  fields: {
    richText: {
      editor: lexicalEditor((c) => {
        c.settings.options.tablePlugin = false
        c.settings.options.codeHighlightPlugin = false
        return c
      }),
    },
  },
})
```

Per-field compact custom field — `apps/webapp/byline/fields/lexical-richtext-compact.ts`:

```ts
type Options = Partial<Omit<RichTextField, 'type' | 'editorConfig'>> & {
  configure?: (config: EditorConfig) => EditorConfig
}

export function lexicalRichTextCompact(options: Options = {}): RichTextField {
  const { configure, ...rest } = options
  const base = applyCompactPreset(cloneDeep(defaultEditorConfig))
  const editorConfig = configure ? configure(base) : base
  return { name: 'richText', label: 'RichText', ...rest, type: 'richText', editorConfig }
}
```

```ts
// In a collection schema
fields: [
  lexicalRichTextCompact({ name: 'caption', label: 'Caption' }),
  // Compact preset, but re-enable lists for this one field:
  lexicalRichTextCompact({
    name: 'summary',
    configure: (c) => { c.settings.options.listPlugin = true; return c },
  }),
]
```

The factory and the custom field follow exactly the pattern the project already established for `availableLanguagesField` (`apps/webapp/byline/fields/available-languages-field.ts`): `Partial<Omit<TargetField, …computed props…>>` for options, an explicit narrow callback for any computed values, no surprises.

### Why this is *not* the deferred feature-graph surface

The deferred "feature-graph configuration" item below is about a **normalised feature shape shared across multiple editor packages** — a contract in `@byline/core` that says "every editor exposes a feature set in roughly the same shape." That commitment is still deferred, and rightly so: there is only one editor today, and the right time to design a shared feature shape is against two real implementations.

Phase 1.5 is strictly smaller. `RichTextField.editorConfig` is `unknown` — the type system explicitly does not know what's in there, and `@byline/core` does not interpret it. Every editor adapter owns its own config shape and owns the cast at its own boundary. A future Phase 4 could still normalise things on top of this without conflict; the opaque slot would either become typed or sit alongside a typed feature graph for editor-specific extras.

## Out of scope — deferred

These are the surfaces we deliberately did **not** add in Phase 1. Each one is here as a placeholder so future contributors (human or agent) understand they were considered and consciously deferred.

### Editor lifecycle hooks

Payload's adapter exposes per-editor lifecycle hooks — typically some combination of `beforeChange`, `afterChange`, `beforeRead`, `serialize`, and `deserialize` — that fire as the document moves through the field pipeline. They are useful when an editor needs to:

- transform its serialized output before it is written to storage (e.g. flatten nested marks, strip unsafe nodes),
- rehydrate a stored shape into the editor's runtime state on read,
- run validation that depends on the editor's internal model rather than the surface field value,
- emit derived data (excerpt, plain-text projection, search payload, table-of-contents).

Byline already has analogous hooks one level up — `FieldHooks.beforeValidate` / `beforeChange` on every field, plus collection-level `beforeRead` / `afterRead` / `beforeChange` / `afterChange`. For Phase 1 the question is *whether the editor needs its own pipeline distinct from the field-level one*, and the honest answer is: not yet. Lexical's serialized state round-trips through the existing `validate` and field hooks without help. If a second editor package surfaces a real need — for example a markdown editor that wants to lint output, or a code editor that wants to attach a syntax-tree to the stored value — that will be the moment to design the editor-level pipeline against two concrete shapes rather than one.

The signal to revisit:

- a second editor implementation arrives,
- *and* it cannot achieve correct round-trip behaviour through the existing `FieldHooks` and collection hooks alone,
- *and* the divergence is in the editor itself (serialization, internal model) rather than in surrounding field semantics.

If only the surrounding semantics differ, the right answer will probably be to extend `FieldHooks` rather than introduce an editor-specific pipeline.

### Feature-graph configuration

Payload's editor adapter takes a feature graph: each editor exports a set of features (heading, link, list, table, code-block, image, custom) that can be toggled, configured, or extended at install time. The runtime composes the feature set into the editor's plugin pipeline.

Byline's `@byline/richtext-lexical` already has an internal `EditorConfig` with feature toggles (`EditorSettings.options` — 29 booleans for tables, links, lists, code highlight, etc.) and accepts a per-instance `editorConfig` prop on `RichTextField`. What we did *not* do is lift any of that into the `RichTextEditorComponent` contract — the contract knows nothing about features, and the configuration object is treated as an opaque editor-private prop today.

That is the right boundary for Phase 1 because the feature shape is highly editor-specific. Lexical's plugin model, TipTap's extension model, and ProseMirror's schema model do not naturally share a feature graph; flattening them prematurely produces a contract that is awkward for all three. The Payload approach works because Payload essentially *is* a Lexical-shaped runtime; Byline does not want to inherit that coupling.

The signal to revisit:

- two or more editor packages exist,
- *and* a real installation needs to express "the same content can be edited in either editor" or "feature parity matters across editors,"
- *and* the per-editor `editorConfig` mechanism has produced enough friction (duplicated UI for picking features, no way to share an editor configuration across collections) that a unified shape would meaningfully help.

Until then, every editor package owns its own feature configuration as plain props, and installations declare features per editor in their admin config.

## Future phases of work

Concrete next steps, roughly ordered by likely sequence. None of these are committed to a timeline; they are listed so the order of operations is obvious if and when richtext work resumes.

### Phase 2 — A second editor package

The single most useful next step is the existence of a second package — almost certainly `@byline/richtext-tiptap` or a markdown-focused `@byline/richtext-md`. Until that exists, every adapter-shape question is one-sided. A second package will surface the real questions:

- Is `RichTextEditorProps` enough, or are editors hitting it?
- Do they share *anything* in the way they want to expose features?
- What does the per-instance `editorConfig` prop look like across editors, and is the variance painful enough to warrant a normalised shape?
- Where do per-editor stylesheet conventions and theme tokens live?

A second package is also where the test for *whether to grow the contract* becomes empirical rather than speculative.

### Phase 3 — Editor lifecycle hooks (if Phase 2 demands them)

If Phase 2 surfaces a real round-trip problem that the existing `FieldHooks` cannot solve, design an editor-level pipeline. Likely shape (subject to the actual divergence):

- `serialize(state) -> stored` and `deserialize(stored) -> state` for editors that want a different storage shape than their runtime shape,
- `beforeChange({ stored, previous }) -> { stored, error? }` for editor-specific transformations (security sanitisation, mark normalisation),
- `afterRead({ stored }) -> stored` for derived projections.

Pipeline ordering relative to field and collection hooks is the design question that matters most here. The likely answer is *editor hooks fire innermost*, between the editor's render boundary and the field-level pipeline — but that should be confirmed against two concrete implementations.

### Phase 4 — Feature-graph configuration (only if Phase 2/3 demand it)

If two or more editor packages settle into compatible feature shapes — or if a real installation needs to express feature parity across editors — design a shared feature-graph contract. Until that pressure exists, treat each editor's configuration as opaque.

A reasonable bar: do not add feature-graph configuration until at least two editor packages have a *compatible* feature surface that cannot be expressed as plain editor-specific props.

### Phase 5 — Editor-side server pipeline (search, excerpt, plain-text)

Independent of the adapter shape: derived projections from rich text content (search payload, excerpt, plain-text fallback for SSR, structured outline) are useful enough to deserve their own design pass once the search / indexing story takes shape. This is more naturally a concern of `@byline/core/services` than the editor adapter, but the editor adapter is the boundary that knows how to traverse its own document tree, so the two will need to agree on a contract.

This phase is genuinely independent of Phases 2–4 and could ship at any point.

### Phase 6 — Per-collection / per-field editor selection

Today's slot is site-wide. A future phase may want to register an editor per collection or per field — for example, a markdown editor in a documentation collection and a Lexical editor in a marketing collection. This is mechanically easy (extend `CollectionAdminConfig` or `FieldAdminConfig` with an editor slot) but has a real product question behind it: how should installations think about editor variance, and is it a per-field property or a per-collection property?

The existing `FieldComponentSlots.Field` already provides the per-field escape hatch and works today. A more structured per-collection / per-field selection is only worth designing once there is a clear product reason.

## Cross-references

- Package: `packages/richtext-lexical/`
- Contract: `packages/core/src/@types/field-types.ts` — `RichTextEditorProps`, `RichTextEditorComponent`
- Slot: `packages/core/src/@types/site-config.ts` — `ClientConfig.fields.richText.editor`
- Renderer: `packages/ui/src/fields/field-renderer.tsx` — `case 'richText'`
- Registration: `apps/webapp/byline.admin.config.ts` — `fields.richText.editor` (commented `lexicalEditor()` example shows the site-wide configuration shape)
- Per-field override (already shipped): `FieldComponentSlots.Field` in `packages/core/src/@types/field-types.ts`
- Phase 1.5 schema slot: `RichTextField.editorConfig?: unknown` in `packages/core/src/@types/field-types.ts`
- Phase 1.5 wrapper resolution: `packages/richtext-lexical/src/richtext-field.tsx` — `resolvedEditorConfig`
- Phase 1.5 registration factory: `packages/richtext-lexical/src/lexical-editor.tsx` — `lexicalEditor(configure?)`
- Phase 1.5 worked custom field: `apps/webapp/byline/fields/lexical-richtext-compact.ts`
