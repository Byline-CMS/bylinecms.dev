# Field API

> Companions:
> - [RICHTEXT.md](./RICHTEXT.md) — the Lexical adapter, its `EditorConfig`, and how `lexicalEditor()` / `defaultEditorConfig` plug in.
> - [ARCHITECTURE.md](./ARCHITECTURE.md) — the schema / admin split (Django-style model vs. ModelAdmin) at the framework level.

This document is the working reference for writing reusable field helpers in `apps/webapp/byline/fields/` (and the equivalent location in any host project). It covers the two kinds of helper, when to use which, how they compose, and the trap that bites if you reach for the wrong one.

## The split

A field lives in two places at once.

- **Schema** (`collections/<name>/schema.ts`) — a `CollectionDefinition` returned by `defineCollection`. Pure data: field names, types, validation, defaults, schema-level adapter config (`editorConfig`, `embedRelationsOnSave`, …). **Must be tsx-loadable** — the server bootstrap in `apps/webapp/byline/server.config.ts` imports schemas directly so seeds and migrations can run outside Vite. No React. No CSS modules. No browser-only globals.
- **Admin** (`collections/<name>/admin.tsx`) — a `CollectionAdminConfig` returned by `defineAdmin`. UI overrides: column definitions, layout, slot components, per-field editor swaps, list view, preview URL builder. React is allowed here. Pulled in by `admin.config.ts`, which is side-effect-imported from `__root.tsx` for both SSR and client.

The split mirrors Django's `Model` / `ModelAdmin`. The same field name shows up on both sides: the schema declares what the field *is*; the admin declares how it *renders* and what UI affordances surround it.

```
fields: [                            fields: {
  { name: 'title', type: 'text' },     title: aiTextFieldAdmin(),
]                                    }
schema (array, data)                 admin (map, keyed by schema name)
```

## Two kinds of helper

Helpers are factory functions that return either side of the split. They live side-by-side in `apps/webapp/byline/fields/` but are exported and consumed differently.

### Schema-side helpers — return a field definition

Drop the result into the schema's `fields` **array**. Must contain only data.

```ts
// apps/webapp/byline/collections/news/schema.ts
import { lexicalRichTextCompact } from '~/fields/lexical-richtext-compact.js'
import { publishedOnField } from '~/fields/published-on-field.js'

export const News = defineCollection({
  path: 'news',
  fields: [
    { name: 'title', type: 'text', localized: true },
    lexicalRichTextCompact({
      name: 'caption',
      label: 'Caption',
      localized: true,
    }),
    publishedOnField,
  ],
})
```

What's allowed:
- Pure data — strings, booleans, numbers, plain config objects.
- Imports from `@byline/core` (types, `defineField`, `defineCollection`).
- Imports from data-only subpaths of UI packages — e.g. `@byline/richtext-lexical/server` re-exports `defaultEditorConfig` precisely for this purpose.

What's forbidden:
- React component references on schema fields.
- Imports from `@byline/ui/react`, `@byline/richtext-lexical` (the root barrel), `@byline/ai/plugins/*`, or any package whose evaluation pulls CSS modules / Lexical runtime.

### Admin-side helpers — return a `FieldAdminConfig`

Drop the result into the admin's `fields` **map**, keyed by the schema field's name. React is welcome.

```ts
// apps/webapp/byline/collections/news/admin.tsx
import { aiTextFieldAdmin } from '~/fields/ai-text.js'
import { aiTextAreaFieldAdmin } from '~/fields/ai-textarea.js'
import { aiRichTextAdmin } from '~/fields/lexical-richtext-ai.js'

export const NewsAdmin = defineAdmin(News, {
  fields: {
    title: aiTextFieldAdmin(),
    summary: aiTextAreaFieldAdmin({
      components: { HelpText: SummaryLength },
    }),
    content: aiRichTextAdmin(),
  },
})
```

What a `FieldAdminConfig` carries today:

| Key | Type | Effect |
|---|---|---|
| `components.Label` | React component | Replaces the field label (receives `FieldLabelSlotProps`). |
| `components.HelpText` | React component | Replaces the help-text line. |
| `components.Field` | React component | Replaces the entire input widget. |
| `components.beforeField` | React component | Adornment rendered between label and input. |
| `components.afterField` | React component | Adornment rendered between input and help text. |
| `editor` | `RichTextEditorComponent` | Swaps the rich-text editor for this one field. Ignored for non-`richText` types. Takes precedence over the globally registered `ClientConfig.fields.richText.editor`. |

## Mixing the two

Because the helpers live at different layers, they stack freely on the same field.

```ts
// schema.ts — compact toolbar baked into editorConfig
fields: [
  lexicalRichTextCompact({ name: 'caption', label: 'Caption' }),
]

// admin.tsx — AI-enabled editor component override
fields: {
  caption: aiRichTextAdmin(),
}
```

At render time the field-renderer resolves the editor component admin-side first (the AI wrapper wins over the global registration), and that component reads `field.editorConfig` from the schema (the compact preset). The result is an AI-enabled editor running the compact toolbar — no special wiring required.

The same applies across helper kinds — `availableLanguagesField()` (schema) and a future `availableLanguagesAdmin()` (admin) would coexist the same way.

## Writing a new helper

### A schema-side helper

```ts
// apps/webapp/byline/fields/my-tagline-field.ts
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

Rules of thumb:
- Return a typed schema field (`TextField`, `RichTextField`, `GroupField`, …). Type the return value so callers get autocomplete and `FieldData<typeof helper>` resolves correctly.
- Accept `Options = Partial<Omit<TheFieldType, 'type'>>` so callers can override anything except the discriminant.
- Keep imports data-only — see "What's forbidden" above. When unsure, ask "will this file load under raw `tsx`?"

### An admin-side helper

```ts
// apps/webapp/byline/fields/character-counter-admin.tsx
import type { FieldAdminConfig, FieldHelpTextSlotProps } from '@byline/core'
import { useFieldValue } from '@byline/ui/react'

function CharacterCount({ path, helpText }: FieldHelpTextSlotProps) {
  const value = useFieldValue<string>(path) ?? ''
  return <span>{helpText ? `${helpText} — ` : ''}{value.length} chars</span>
}

export function characterCountAdmin(): FieldAdminConfig {
  return { components: { HelpText: CharacterCount } }
}
```

Rules of thumb:
- Return `FieldAdminConfig`. Don't widen the return type — callers should get the same shape `defineAdmin` expects.
- React, hooks, CSS modules — all fine. This file is only evaluated in the admin module graph.
- Slot components have access to form state via `useFieldValue`, `useFieldError`, `useFormContext`, etc. — no need to plumb props.

## Common pitfalls

### Putting a React component reference on a schema field

The trap: a schema-side factory that bakes a React component into the returned schema (e.g. an `editor: MyEditor` assignment on a `RichTextField`). The factory's *output* contains a runtime reference to React, so `News` → `server.config.ts` now imports React and Lexical. Seeds via `tsx` start failing on CSS module imports.

If a field needs a React swap, put it on the admin side via `FieldAdminConfig.editor` (or the `components.Field` slot for non-rich-text fields), not on the schema.

### Importing from a React-y barrel inside a schema-side helper

Subtler version of the same trap. The factory's *output* is fine (data only), but its import statement reaches into a barrel that re-exports React components, triggering their evaluation when the schema module loads. Example: `import { defaultEditorConfig } from '@byline/richtext-lexical'` — `defaultEditorConfig` is data, but the root barrel re-exports `RichTextField` and friends, which loads CSS.

The fix is always the same: find or create a data-only subpath of the package (`@byline/richtext-lexical/server` re-exports the schema-relevant data here) and import from there.

### Using `lexicalRichTextCompact` to enable AI

`lexicalRichTextCompact` is schema-side; it customises `editorConfig` (data). It cannot swap the editor *component*. Use `aiRichTextAdmin()` admin-side for that, or — for site-wide AI — register `LexicalRichTextAi` as `ClientConfig.fields.richText.editor` in `admin.config.ts`.

### Putting AI text-field slots in the schema

`aiTextFieldAdmin()` / `aiTextAreaFieldAdmin()` attach `Label` and `afterField` slots — both React. They go in `admin.tsx`, not `schema.ts`. The schema entry stays a plain `{ name, type: 'text' }`.

## Cross-references

- Existing helpers in `apps/webapp/byline/fields/` — each has a file-level header naming its layer (schema or admin) and pointing back to this doc.
- `packages/core/src/@types/field-types.ts` — `RichTextField`, `FieldComponentSlots`, `RichTextEditorComponent`, slot prop interfaces.
- `packages/core/src/@types/admin-types.ts` — `FieldAdminConfig`, `CollectionAdminConfig`.
- `packages/ui/src/forms/form-renderer.tsx` — where `adminConfig.fields[name].components` and `.editor` are read and forwarded to `FieldRenderer`.
- `packages/ui/src/fields/field-renderer.tsx` — where the per-field editor override is preferred over the global registration.
