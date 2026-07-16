---
'@byline/core': minor
'@byline/admin': minor
---

Blocks: per-block admin config and a dedicated code field.

- **`defineBlockAdmin()` / `ClientConfig.blockAdmin`** — the block-scoped half of the schema/admin split. A `BlockAdminConfig` carries per-field rendering overrides (`components`, richtext `editor`) keyed by the block's top-level field names, registered site-wide by `blockType` and applied wherever the block renders. Boot-validated against the blocks declared across collections. Block-nested richText fields can now opt into a specific editor (e.g. a plain non-AI editor on one block while the site-wide registration stays AI-enabled).
- **`type: 'code'` field** — a dedicated source-code field storing a plain string in the existing text store (no migration). The admin widget is a lazily-loaded CodeMirror 6 editor (kept out of the main admin chunk; per-language grammars load on demand) with light/dark theming driven by CSS custom properties. `language` sets a static highlight language; `languageField` binds highlighting to a sibling select at runtime. Excluded from full-text search indexing by design; exports as a fenced block in the markdown surface.
