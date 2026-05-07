---
"@byline/host-tanstack-start": minor
"@byline/core": minor
"@byline/admin": minor
"@byline/auth": minor
"@byline/cli": minor
"@byline/client": minor
"@byline/db-postgres": minor
"@byline/richtext-lexical": minor
"@byline/storage-local": minor
"@byline/storage-s3": minor
"@byline/ui": minor
---

New: defineField helper (feat(core))
Mirror of defineCollection / defineBlock for single fields. Locks in literal types when a field is authored outside a fields: [...] array — useful
for fields shared across multiple collections, or for surfacing definition-site type errors without waiting for placement. Replaces the as const
satisfies Field pattern. Companion publishedOnField factory now lives in apps/webapp/byline/fields/ and replaces three inline copies in the docs,
news, and pages schemas.

Internal: shared field-tree walker (refactor(core))
Extracted walkFieldTree (in packages/core/src/services/) plus tests, and rebuilt both populate (relation traversal) and richtext-populate on top.
~120 lines of duplicated traversal logic deleted; behaviour-preserving. Sets up future field-walking surfaces (validation, indexing, beforeRead
scoping) to share one tree-walk implementation.

Tightened: CollectionAdminConfig.preview contract (refactor(core))
Removed the unused populate?: PopulateSpec option from the preview block — it was declared but never consumed by any loader. Documented what is
actually available on doc inside preview.url(...): top-level columns (including the reserved path), every source-collection field under doc.fields,
and direct relation targets via the edit view's blanket depth-1 populate (picker projection). The four seeded admin configs (docs, news, pages,
media) updated to match.

▎ ⚠️ Breaking (theoretical): CollectionAdminConfig.preview.populate removed from the public type. Safe in practice — the field had no consumer code,
▎ so any external preview.populate: { … } was already a no-op. If you've authored one, drop the property; the rest of the preview shape is
▎ unchanged.
