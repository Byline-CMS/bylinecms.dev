---
title: "Fields API"
path: "fields"
summary: "The Fields API: built-in types, optional, localized, validation, hooks, the schema-vs-admin split, and how to build reusable field helpers like availableLanguagesField."
---

# Fields API

Companions:
- [RICHTEXT.md](./RICHTEXT.md) — the Lexical adapter and how `lexicalEditor()` / per-field editor overrides plug in.
- [COLLECTIONS.md](./COLLECTIONS.md) — collection-level admin (columns, layout, preview URL, custom list views).
- [ARCHITECTURE.md](./ARCHITECTURE.md) — the schema / admin split (Django-style model vs ModelAdmin) at the framework level.

## Overview

A field in Byline lives on two sides of a deliberate split. The **schema** describes what the field *is* — name, type, validation, defaults, schema-level adapter config. The **admin** describes how the field *renders* in the dashboard — slot-component overrides for label, input, help text, adornments, and the per-field richtext editor swap. This doc is the working reference for both sides: how the split works, how to write helpers for each side, and how field-level component slots compose.

The split mirrors Django's `Model` / `ModelAdmin`. The same field name appears on both sides — the schema's `fields[]` array declares the data; the admin's `fields{}` map (keyed by schema field name) attaches presentation.

```
fields: [                            fields: {
  { name: 'title', type: 'text' },     title: aiTextFieldAdmin(),
]                                    }
schema (array, data)                 admin (map, keyed by schema name)
```

---

## Quick reference

Each entry is the minimal shape for one task. The "Edit" line tells you which file you actually change; the link at the end of each entry points at the deeper architecture section.

### 1. Drop in a schema-side helper

Use a pre-built field definition from `apps/webapp/byline/fields/`. Schema-side helpers are pure data — drop them in the schema's `fields[]` array.

**Edit:** `apps/webapp/byline/collections/<name>/schema.ts`

```ts
import { publishedOnField } from '../../fields/published-on-field.js'

export const News = defineCollection({
  path: 'news',
  fields: [
    { name: 'title', type: 'text', localized: true },
    { name: 'content', type: 'richText' },
    publishedOnField,
  ],
})
```

→ [Schema-side helpers](#schema-side-helpers)

### 2. Drop in an admin-side helper

Use a pre-built `FieldAdminConfig` from `apps/webapp/byline/fields/`. Admin-side helpers can include React — drop them in the admin's `fields{}` map, keyed by the schema field's name.

**Edit:** `apps/webapp/byline/collections/<name>/admin.tsx`

```ts
import { aiTextFieldAdmin } from '../../fields/ai-text.js'
import { aiRichTextAdmin } from '../../fields/lexical-richtext-ai.js'

export const NewsAdmin = defineAdmin(News, {
  fields: {
    title: aiTextFieldAdmin(),
    content: aiRichTextAdmin(),
  },
})
```

→ [Admin-side helpers](#admin-side-helpers)

### 3. Replace the entire input (`Field` slot)

When the built-in widget isn't right, swap the entire input via `components.Field`. The component receives `FieldInputSlotProps` and must call `onChange` to commit changes back to the form store.

**Edit:** `apps/webapp/byline/collections/<name>/admin.tsx`

```tsx
import type { FieldInputSlotProps } from '@byline/core'

function ColorSwatchInput({ value, onChange }: FieldInputSlotProps) {
  return <input type="color" value={value ?? '#000000'} onChange={(e) => onChange(e.target.value)} />
}

export const ProductAdmin = defineAdmin(Product, {
  fields: {
    accentColor: { components: { Field: ColorSwatchInput } },
  },
})
```

→ [Field component slots](#field-component-slots)

### 4. Customise the label

Replace the default `<Label>` for one field via `components.Label`. Useful for adding an icon, a status pill, or a toggle next to the label.

**Edit:** `apps/webapp/byline/collections/<name>/admin.tsx`

```tsx
import type { FieldLabelSlotProps } from '@byline/core'

function RequiredLabel({ label, required }: FieldLabelSlotProps) {
  return <span>{label}{required && <em className="text-red-500"> *</em>}</span>
}

export const NewsAdmin = defineAdmin(News, {
  fields: {
    title: { components: { Label: RequiredLabel } },
  },
})
```

→ [Field component slots](#field-component-slots)

### 5. Replace the help text

Replace the default help-text line via `components.HelpText`. Reactive to form state — the slot can read live field values to render things like character counts.

**Edit:** `apps/webapp/byline/collections/<name>/admin.tsx`

```tsx
import type { FieldHelpTextSlotProps } from '@byline/core'
import { useFieldValue } from '@byline/admin/react'

function CharacterCount({ path, helpText }: FieldHelpTextSlotProps) {
  const value = useFieldValue<string>(path) ?? ''
  return <span>{helpText && `${helpText} — `}{value.length} chars</span>
}

export const NewsAdmin = defineAdmin(News, {
  fields: {
    summary: { components: { HelpText: CharacterCount } },
  },
})
```

→ [Field component slots](#field-component-slots)

### 6. Add a before/after adornment

`beforeField` renders between the label and the input; `afterField` renders between the input and the help text. The `aiTextFieldAdmin` helper uses `afterField` to mount the AI panel.

**Edit:** `apps/webapp/byline/collections/<name>/admin.tsx`

```tsx
import type { FieldAdornmentSlotProps } from '@byline/core'

function Hint({ name }: FieldAdornmentSlotProps) {
  return <p className="text-xs text-gray-500">Editable in any locale; defaults from primary locale.</p>
}

fields: {
  body: { components: { afterField: Hint } },
}
```

→ [Field component slots](#field-component-slots)

### 7. Per-field richtext editor override

For `type: 'richText'` fields only — swap the editor component itself (not just its settings). Lives on the admin side because it carries a React reference. Site-wide override is in `admin.config.ts`; per-field override goes here.

**Edit:** `apps/webapp/byline/collections/<name>/admin.tsx`

```ts
import { aiRichTextAdmin } from '../../fields/lexical-richtext-ai.js'

fields: {
  content: aiRichTextAdmin(),   // sets `editor: LexicalRichTextAi` for this field
}
```

→ [Per-field richtext editor](#per-field-richtext-editor)

### 8. Write a new schema-side helper

A factory that returns a typed schema field. Pure data, tsx-loadable.

**Edit:** `apps/webapp/byline/fields/<my-helper>.ts`

```ts
import type { TextField } from '@byline/core'

type Options = Partial<Omit<TextField, 'type'>>

export function taglineField(options: Options = {}): TextField {
  return {
    name: 'tagline',
    label: 'Tagline',
    ...options,
    type: 'text',
    validation: { maxLength: 80, ...options.validation },
  }
}
```

→ [Schema-side helpers](#schema-side-helpers)

### 9. Write a new admin-side helper

A factory that returns a `FieldAdminConfig`. React is welcome here.

**Edit:** `apps/webapp/byline/fields/<my-helper>.tsx`

```tsx
import type { FieldAdminConfig, FieldHelpTextSlotProps } from '@byline/core'
import { useFieldValue } from '@byline/admin/react'

function CharacterCount({ path, helpText }: FieldHelpTextSlotProps) {
  const value = useFieldValue<string>(path) ?? ''
  return <span>{helpText ? `${helpText} — ` : ''}{value.length} chars</span>
}

export function characterCountAdmin(): FieldAdminConfig {
  return { components: { HelpText: CharacterCount } }
}
```

→ [Admin-side helpers](#admin-side-helpers)

### 10. Mix schema preset + admin override on one field

The two layers stack cleanly. A schema-side helper bakes data into `editorConfig`; an admin-side helper attaches React components. The field-renderer resolves both at render time.

**Edit:** `apps/webapp/byline/collections/<name>/schema.ts` *and* `apps/webapp/byline/collections/<name>/admin.tsx`

```ts
// schema.ts — compact toolbar baked into editorConfig (data)
fields: [
  lexicalRichTextCompact({ name: 'caption', label: 'Caption' }),
]
```

```ts
// admin.tsx — AI editor component override (React)
fields: {
  caption: aiRichTextAdmin(),
}
```

→ [Mixing both layers](#mixing-both-layers)

---

## Architecture

### The schema / admin split

A field lives in two places at once:

- **Schema** (`collections/<name>/schema.ts`) — a `CollectionDefinition` returned by `defineCollection`. Pure data: field names, types, validation, defaults, schema-level adapter config (`editorConfig`, `embedRelationsOnSave`, `localized`, …). **Must be tsx-loadable** — the server bootstrap in `apps/webapp/byline/server.config.ts` imports schemas directly so seeds and migrations can run outside Vite. No React. No CSS modules. No browser-only globals.
- **Admin** (`collections/<name>/admin.tsx`) — a `CollectionAdminConfig` returned by `defineAdmin`. UI overrides: per-field slot components, the per-field editor swap, columns, layout, preview URL. React is allowed here. Pulled in by `admin.config.ts`, which is side-effect-imported from `__root.tsx` so the registration covers both SSR and client module graphs.

The schema declares what the field *is*; the admin declares how it *renders*. The two cooperate at render time — schema declares `richText` and the admin attaches the editor component — and never collide because they target different layers of the pipeline.

**Why the split is strict.** The server-side bootstrap loads collection schemas under raw `tsx` for seeds, migrations, and ESM imports outside the Vite graph. The moment a schema file (or any of its imports, transitively) reaches React, CSS modules, or a Lexical runtime, that bootstrap breaks. The split forces React-bearing code onto the admin side, where it stays inside the Vite-managed admin module graph.

### Schema-side helpers

A schema-side helper is a factory that returns a typed field definition. The result drops into the schema's `fields[]` array.

**Rules of thumb.**
- Return a typed schema field (`TextField`, `RichTextField`, `GroupField`, …). Type the return value so callers get autocomplete and `FieldData<typeof helper>` resolves correctly.
- Accept `Options = Partial<Omit<TheFieldType, 'type'>>` so callers can override anything except the discriminant.
- Keep imports data-only — `@byline/core` types, `defineField`, `defineCollection`, the project's i18n locale list. When unsure, ask "will this file load under raw `tsx`?"

**What's forbidden.**
- React component references on schema fields.
- Imports from `@byline/admin/react`, `@byline/ui/react`, `@byline/richtext-lexical` (the root barrel), `@byline/ai/plugins/*`, or any package whose evaluation pulls CSS modules or a Lexical runtime.

**Data-only subpaths.** Some packages publish a separate entry point for the schema-relevant data — `@byline/richtext-lexical/server` re-exports `defaultEditorConfig` precisely so schema-side helpers can use it without dragging the React entry along. Import from those subpaths when they exist.

**Two patterns:**

```ts
// Plain value — define once, drop in many collections.
export const publishedOnField = defineField({
  name: 'publishedOn',
  label: 'Published On',
  type: 'datetime',
  mode: 'datetime',
})
```

```ts
// Factory — accept caller overrides.
export function lexicalRichTextCompact(options: Options = {}): RichTextField {
  const { configure, ...rest } = options
  const base = applyCompactPreset(structuredClone(defaultEditorConfig))
  const editorConfig = configure ? configure(base) : base
  return { name: 'richText', label: 'RichText', ...rest, type: 'richText', editorConfig }
}
```

### Admin-side helpers

An admin-side helper is a factory that returns a `FieldAdminConfig`. The result drops into the admin's `fields{}` map, keyed by the schema field's name.

```ts
// packages/core/src/@types/admin-types.ts (excerpt)
export interface FieldAdminConfig {
  components?: FieldComponentSlots
  editor?: RichTextEditorComponent  // only meaningful on richText fields
}
```

**Rules of thumb.**
- Return `FieldAdminConfig`. Don't widen the return type — callers should get the same shape `defineAdmin` expects.
- React, hooks, CSS modules — all fine. This file is only evaluated in the admin module graph.
- Slot components can use the form-context hooks (`useFieldValue`, `useFieldError`, `useFormContext`) — no need to plumb props in from the caller.

**Worked example — the AI text helper.** `aiTextFieldAdmin()` attaches two slot components: a `Label` replacement that adds an AI toggle button, and an `afterField` adornment that mounts the AI panel. Pairs with a plain `{ type: 'text' }` entry on the schema side.

```ts
// apps/webapp/byline/fields/ai-text.ts
import { AiFieldLabel } from './ai-widgets/ai-field-label.js'
import { AiFieldPanel } from './ai-widgets/ai-field-panel.js'

export function aiTextFieldAdmin(
  options: { components?: FieldComponentSlots } = {}
): FieldAdminConfig {
  const { components: extra } = options
  return {
    components: {
      Label: AiFieldLabel,
      afterField: AiFieldPanel,
      ...extra,
    },
  }
}
```

### Field component slots

`FieldComponentSlots` is the per-field surface for swapping or augmenting the default rendering. Every value field (anything that isn't `array`, `blocks`, or `group`) accepts the same five slots.

| Slot | Effect | Props |
|---|---|---|
| `Label` | Replaces the default `<Label>`. | `FieldLabelSlotProps` |
| `HelpText` | Replaces the default help-text line. | `FieldHelpTextSlotProps` |
| `Field` | Replaces the entire input widget. | `FieldInputSlotProps` |
| `beforeField` | Adornment between label and input. | `FieldAdornmentSlotProps` |
| `afterField` | Adornment between input and help text. | `FieldAdornmentSlotProps` |

**Slot prop shapes.** Every slot prop interface extends `FieldSlotBaseProps`, which carries the field's `name`, `path`, `value`, `id` (HTML), and the underlying field definition. The two replacement slots add specifics:

```ts
// FieldInputSlotProps (Field replacement)
{
  onChange: (value: any) => void   // call this to write a new value
  defaultValue?: any
  placeholder?: string
  // …plus the base props (name, path, value, id, field, etc.)
}

// FieldLabelSlotProps
{ label?: string; required?: boolean; /* + base */ }

// FieldHelpTextSlotProps
{ helpText?: string; /* + base */ }

// FieldAdornmentSlotProps
{ /* base only */ }
```

**Two important behaviours:**

1. **`Field` *replaces* — not augments.** When a `Field` slot is provided, the default input is not rendered. The slot is responsible for calling `onChange` to commit changes back into the form store (the form hook pipeline runs from there).
2. **Form-context hooks work everywhere.** Slot components can call `useFieldValue(path)`, `useFieldError(path)`, `useFormContext()` etc. directly — there's no need to plumb live data in through props. This is what makes the `CharacterCount` HelpText example one short component.

### Per-field richtext editor

For `type: 'richText'` fields only, `FieldAdminConfig.editor` swaps the entire editor *component* — not just its settings. Use it to opt one specific field into an alternate editor (e.g. an AI-enabled wrapper around the default Lexical field) without changing the site-wide registration.

```ts
// admin.tsx
fields: {
  content: { editor: LexicalRichTextAi },
}
```

Lives on the admin side because it carries a React component reference, and schemas must stay tsx-loadable. Per-field `editor` takes precedence over the globally registered `ClientConfig.fields.richText.editor`. Ignored on non-`richText` fields.

For *settings* differences only (placeholder, toolbar toggles, the inline-image upload collection), use a schema-side preset like `lexicalRichTextCompact` instead — that data is JSON-safe and rides along in `RichTextField.editorConfig`. See [RICHTEXT.md](./RICHTEXT.md) for the full editor configuration story.

### Mixing both layers

Because the helpers live at different layers, they stack freely on the same field.

```ts
// schema.ts — compact toolbar baked into editorConfig (data)
fields: [
  lexicalRichTextCompact({ name: 'caption', label: 'Caption' }),
]

// admin.tsx — AI-enabled editor component override (React)
fields: {
  caption: aiRichTextAdmin(),
}
```

At render time the field-renderer resolves the editor component admin-side first (the AI wrapper wins over the global registration), and that component reads `field.editorConfig` from the schema (the compact preset). The result is an AI-enabled editor running the compact toolbar — no special wiring required. The same applies across helper kinds — a schema-side `availableLanguagesField()` and a future `availableLanguagesAdmin()` would coexist the same way.

---

## Common pitfalls

### Putting a React component reference on a schema field

The trap: a schema-side factory that bakes a React component into the returned schema (e.g. an `editor: MyEditor` assignment on a `RichTextField`). The factory's *output* contains a runtime reference to React, so the chain `schema.ts` → `server.config.ts` now imports React and Lexical. Seeds via `tsx` start failing on CSS module imports.

If a field needs a React swap, put it on the admin side via `FieldAdminConfig.editor` (or `components.Field` for non-rich-text fields). Never on the schema.

### Importing from a React-y barrel inside a schema-side helper

A subtler version of the same trap. The factory's *output* is fine (data only), but its import statement reaches into a barrel that re-exports React components, triggering their evaluation when the schema module loads. Example: `import { defaultEditorConfig } from '@byline/richtext-lexical'` — `defaultEditorConfig` is data, but the root barrel re-exports `RichTextField` and friends, which loads CSS.

The fix is always the same: find or create a data-only subpath of the package (`@byline/richtext-lexical/server` re-exports the schema-relevant data here) and import from there.

### Using `lexicalRichTextCompact` to enable AI

`lexicalRichTextCompact` is schema-side; it customises `editorConfig` (data). It cannot swap the editor *component*. Use `aiRichTextAdmin()` admin-side for that, or — for site-wide AI — register `LexicalRichTextAi` as `ClientConfig.fields.richText.editor` in `admin.config.ts`.

### Putting AI text-field slots in the schema

`aiTextFieldAdmin()` / `aiTextAreaFieldAdmin()` attach `Label` and `afterField` slots — both React. They go in `admin.tsx`, not `schema.ts`. The schema entry stays a plain `{ name, type: 'text' }`.

---

## Code map

| Concern | Location |
|---|---|
| `FieldComponentSlots` + slot prop interfaces | `packages/core/src/@types/field-types.ts` |
| `FieldAdminConfig` (per-field admin shape) | `packages/core/src/@types/admin-types.ts` |
| `CollectionAdminConfig` (collection-level admin shape) | `packages/core/src/@types/admin-types.ts` |
| `RichTextEditorComponent` (per-field richtext override type) | `packages/core/src/@types/field-types.ts` |
| Field-renderer dispatch (resolves slots + per-field editor) | `packages/ui/src/fields/field-renderer.tsx` |
| Form-renderer (reads `adminConfig.fields[name]`) | `packages/ui/src/forms/form-renderer.tsx` |
| Existing schema-side helpers | `apps/webapp/byline/fields/{published-on-field,available-languages-field,lexical-richtext-compact}.ts` |
| Existing admin-side helpers | `apps/webapp/byline/fields/{ai-text,ai-textarea,lexical-richtext-ai}.{ts,tsx}` |
| AI widgets used by admin-side helpers | `apps/webapp/byline/fields/ai-widgets/` |
| Reference admin config (admin-side wiring) | `apps/webapp/byline/admin.config.ts` |
| Reference server config (schema-only wiring) | `apps/webapp/byline/server.config.ts` |
