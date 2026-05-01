# Rich Text Editor

> Companions:
> - [CORE-COMPOSITION.md](./CORE-COMPOSITION.md) — the broader roadmap for how Byline composes adapter packages (db, storage, session, and now editors).
> - [RELATIONSHIPS.md](./RELATIONSHIPS.md) — the richtext editor's link and inline-image plugins are the first non-form consumer of the populate pipeline; future editor work continues to lean on the relation field surface.

## Overview

Byline's richtext editing is **pluggable through a deliberately small adapter contract**. Today the project ships one editor package — `@byline/richtext-lexical` — built on Lexical. The contract that lets it plug in (and that any future editor would plug in through) is a single typed component slot on the client config. Nothing more.

The shape is intentionally minimal. Other CMS frameworks ship a substantial editor-adapter API — editor-specific lifecycle hooks (`beforeChange` / `afterChange` / `beforeRead` / `serialize` / `deserialize`), a feature graph that toggles plugins on or off, and a runtime that orchestrates them alongside the rest of the field pipeline. That is a powerful surface but a meaningful design commitment, and one that is much easier to *shape* against multiple real editor implementations than to *guess* against one. Byline inverts the order: extract the package boundary first, grow the contract only when a second editor package or a real product requirement forces a specific shape. The risk of staying small is low (the contract can be extended); the cost of overshooting is real (a broad adapter shape locked in around the quirks of one editor).

Three things compose the present surface:

1. **The component contract** — `RichTextEditorComponent` in `@byline/core`. Mirrors what `field-renderer.tsx` was already passing for `type: 'richText'` fields.
2. **The site-wide slot** — `ClientConfig.fields.richText.editor`. Registered once, used everywhere a `richText` field renders.
3. **An opaque per-field config slot** — `RichTextField.editorConfig?: unknown`. Each editor adapter owns its own config shape; `@byline/core` does not interpret it.

`@byline/ui` no longer depends on Lexical at all — the editor is registered by the integrating app, not the UI package.

## The contract

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

## The slot

```ts
// packages/core/src/@types/site-config.ts (excerpt)

export interface ClientConfig extends BaseConfig {
  admin?: CollectionAdminConfig[]
  fields?: {
    richText?: { editor: RichTextEditorComponent }
  }
}
```

`fields` is namespaced rather than flat so additional field-level defaults (custom widgets, formatters, etc.) can be registered there as the system grows, without each one negotiating a top-level config key.

## Registration

```ts
// apps/webapp/byline/admin.config.ts

import { lexicalEditor } from '@byline/richtext-lexical'

defineClientConfig({
  // ...
  fields: {
    richText: { editor: lexicalEditor() },
  },
})
```

`@byline/richtext-lexical` exports `RichTextField` directly as the component matching `RichTextEditorComponent` and `lexicalEditor()` as a registration factory that bakes editor settings in via a closure. Either form satisfies the slot. Alternative editor packages (a future `@byline/richtext-tiptap` or `@byline/richtext-md`) only need to export a component matching the same contract.

## Renderer behaviour

`packages/ui/src/fields/field-renderer.tsx` reads the configured editor at render time:

```tsx
case 'richText': {
  const RichTextEditor = getClientConfig().fields?.richText?.editor
  if (!RichTextEditor) {
    throw new Error(
      'No richText editor registered. Install @byline/richtext-lexical and set ' +
        '`fields.richText.editor` in your admin config (byline/admin.config.ts).'
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

The throw is the failure mode by design. A `richText` field with no editor configured is unusable; loud, fast feedback at first render is the right behaviour rather than a silent textarea fallback that could ship to production unnoticed.

Per-field `FieldComponentSlots.Field` overrides keep precedence over the site-wide default — the existing per-field component override mechanism handles the "this one field needs a different editor entirely" case without a new override layer.

## Editor configuration — three layers, opaque to core

Editor settings can come from three places. The wrapper in `@byline/richtext-lexical` resolves them in priority order:

1. **`field.editorConfig`** — most specific. The schema author opted in for this field.
2. **`editorConfig` prop** baked in via `lexicalEditor(configure)` at registration.
3. **`defaultEditorConfig`** — package fallback.

`RichTextField.editorConfig` is typed `unknown` in `@byline/core`. The shape is opaque — each editor adapter defines what it accepts. For `@byline/richtext-lexical` this is the package's `EditorConfig`; for a hypothetical TipTap adapter it would be a TipTap extension list. The core contract does not interpret the value; the editor adapter casts at its own boundary.

### Site-wide reduced editor

```ts
// apps/webapp/byline/admin.config.ts
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

`lexicalEditor(configure?)` returns a `RichTextEditorComponent` with editor settings baked in via closure. The `configure` callback receives a `cloneDeep(defaultEditorConfig)` so mutating it is safe and never leaks across registrations. `lexicalEditor()` with no argument is equivalent to registering `RichTextField` directly.

### Per-field compact custom field

Define a custom field factory that bakes an `editorConfig` into the schema:

```ts
// apps/webapp/byline/fields/lexical-richtext-compact.ts

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

The factory pattern matches the project convention already established for `availableLanguagesField`: `Partial<Omit<TargetField, …computed props…>>` for options, an explicit narrow callback for any computed values, no surprises.

### Why the core contract stays opaque

The `unknown` typing on `RichTextField.editorConfig` is deliberate. The shape of an editor's configuration is highly editor-specific — Lexical's plugin model, TipTap's extension model, and ProseMirror's schema model do not naturally share a feature graph. A shared shape across adapters would be awkward for all three. Each editor adapter owns its own config shape and its own cast at its own boundary; the core contract stays out of the way.

A future shared feature-graph contract (Phase 4 below) could either replace the opaque slot or sit alongside it for editor-specific extras. Until two editor packages exist with a genuinely compatible feature surface, the opaque slot is the correct shape.

## Plugins as the first cross-system consumer

The Lexical plugins for richtext document links and inline images are the first non-form consumer of Byline's populate pipeline. Both plugins consume the same `DocumentRelation` envelope, share the `RelationPicker`, and use the same modal-form-state machinery (`field/shared/useModalFormState.ts`). See [RELATIONSHIPS.md § Richtext document links](./RELATIONSHIPS.md#richtext-document-links).

Two implications worth flagging:

- **A future richtext editor adapter that wants document links inherits the `DocumentRelation` envelope** rather than inventing its own. The picker is reusable; the envelope shape (flat attributes, `_resolved` / `_cycle` discriminators) is what the populate pipeline produces and consumes.
- **Read-time hydration (Mode 2) is opt-in.** The `inline-image-after-read.ts` hook exists in the package but is not wired into any collection. Save-time denormalisation (Mode 1) is the active default; opt into Mode 2 by adding the hook to a collection's `afterRead` slot when staleness becomes a problem.

## Future phases of work

Concrete next steps, roughly ordered by likely sequence. None are committed to a timeline; they're listed so the order of operations is obvious if and when richtext work resumes.

### Phase 2 — A second editor package

The single most useful next step is the **existence of a second editor package** — almost certainly `@byline/richtext-tiptap` or a markdown-focused `@byline/richtext-md`. Until that exists, every adapter-shape question is one-sided. A second package will surface the real questions:

- Is `RichTextEditorProps` enough, or are editors hitting its limits?
- Do they share *anything* in the way they want to expose features?
- What does the per-instance `editorConfig` prop look like across editors, and is the variance painful enough to warrant a normalised shape?
- Where do per-editor stylesheet conventions and theme tokens live?

A second package is also where the test for *whether to grow the contract* becomes empirical rather than speculative.

### Phase 3 — Editor lifecycle hooks (if Phase 2 demands them)

Other CMS frameworks expose per-editor lifecycle hooks — typically `beforeChange`, `afterChange`, `beforeRead`, `serialize`, `deserialize` — that fire as the document moves through the field pipeline. Useful when an editor needs to:

- transform its serialized output before storage (flatten nested marks, strip unsafe nodes),
- rehydrate a stored shape into the editor's runtime state on read,
- run validation that depends on the editor's internal model rather than the surface field value,
- emit derived data (excerpt, plain-text projection, search payload, table-of-contents).

Byline already has analogous hooks one level up — `FieldHooks.beforeValidate` / `beforeChange` on every field, plus collection-level `beforeRead` / `afterRead` / `beforeChange` / `afterChange`. The question is whether a future editor needs its own pipeline distinct from the field-level one. Lexical's serialized state round-trips through the existing `validate` and field hooks without help. If a second editor surfaces a real need — for example a markdown editor that wants to lint output, or a code editor that wants to attach a syntax tree to the stored value — that becomes the moment to design the editor-level pipeline against two concrete shapes rather than one.

The signal to revisit:

- a second editor implementation arrives, *and*
- it cannot achieve correct round-trip behaviour through the existing `FieldHooks` and collection hooks alone, *and*
- the divergence is in the editor itself (serialization, internal model) rather than in surrounding field semantics.

If only the surrounding semantics differ, the right answer is to extend `FieldHooks` rather than introduce an editor-specific pipeline.

Pipeline ordering relative to field and collection hooks is the design question that matters most. The likely answer is *editor hooks fire innermost*, between the editor's render boundary and the field-level pipeline — but that should be confirmed against two concrete implementations.

### Phase 4 — Feature-graph configuration (only if Phase 2/3 demand it)

If two or more editor packages settle into compatible feature shapes — or if a real installation needs to express feature parity across editors — design a shared feature-graph contract. Until that pressure exists, every editor's configuration stays opaque (today's `RichTextField.editorConfig: unknown` plus the per-package config types).

A reasonable bar: do not add feature-graph configuration until at least two editor packages have a *compatible* feature surface that cannot be expressed as plain editor-specific props.

### Phase 5 — Editor-side server pipeline (search, excerpt, plain text)

Independent of the adapter shape: derived projections from rich text content (search payload, excerpt, plain-text fallback for SSR, structured outline) are useful enough to deserve their own design pass once the search / indexing story takes shape. This is more naturally a concern of `@byline/core/services` than the editor adapter, but the editor adapter is the boundary that knows how to traverse its own document tree, so the two will need to agree on a contract.

This phase is genuinely independent of Phases 2–4 and could ship at any point.

### Phase 6 — Per-collection / per-field editor selection

Today's slot is site-wide. A future phase may want to register an editor per collection or per field — for example, a markdown editor in a documentation collection and a Lexical editor in a marketing collection. This is mechanically easy (extend `CollectionAdminConfig` or `FieldAdminConfig` with an editor slot) but has a real product question behind it: how should installations think about editor variance, and is it a per-field property or a per-collection property?

The existing `FieldComponentSlots.Field` already provides the per-field escape hatch and works today. A more structured per-collection or per-field selection is only worth designing once there's a clear product reason.

## Code map

| Concern                                       | Location                                                                  |
|-----------------------------------------------|---------------------------------------------------------------------------|
| `RichTextEditorProps` / `RichTextEditorComponent` contract | `packages/core/src/@types/field-types.ts`                |
| `ClientConfig.fields.richText.editor` slot    | `packages/core/src/@types/site-config.ts`                                 |
| `RichTextField.editorConfig` opaque slot      | `packages/core/src/@types/field-types.ts`                                 |
| Renderer dispatch                             | `packages/ui/src/fields/field-renderer.tsx` (`case 'richText'`)           |
| Lexical editor package                        | `packages/richtext-lexical/`                                              |
| Lexical wrapper + `editorConfig` resolution   | `packages/richtext-lexical/src/richtext-field.tsx`                        |
| `lexicalEditor()` registration factory        | `packages/richtext-lexical/src/lexical-editor.tsx`                        |
| Default editor config + presets               | `packages/richtext-lexical/src/field/config/`                             |
| Link plugin                                   | `packages/richtext-lexical/src/field/plugins/link-plugin/`                |
| Inline image plugin                           | `packages/richtext-lexical/src/field/plugins/inline-image-plugin/`        |
| Per-field component override                  | `FieldComponentSlots.Field` in `packages/core/src/@types/field-types.ts`  |
| Worked compact custom field                   | `apps/webapp/byline/fields/lexical-richtext-compact.ts`                   |
| Reference registration                        | `apps/webapp/byline/admin.config.ts`                                      |
