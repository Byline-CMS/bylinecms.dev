# Orderable collections

> Companions:
> - [CORE-DOCUMENT-STORAGE.md](./CORE-DOCUMENT-STORAGE.md) — `order_key` is the third system attribute (after `id` and `path`) promoted out of the EAV layer onto a top-level column.
> - [RELATIONSHIPS.md](./RELATIONSHIPS.md) — `hasMany` relations carry their own array order inside a field value; that is orthogonal to collection-level order described here.

## Overview

`order_key` is an opt-in fractional-index column on `byline_documents` that lets editors drag rows in a collection's list view to define a canonical order. Useful for short, finite, naturally ordered collections — bios, team members, FAQ items, news categories, navigation sections — where alphabetical or `createdAt` ordering doesn't tell the right story.

Three rules anchor the model:

1. **Opt-in per collection.** `defineAdmin({ orderable: true })`. Off by default; nothing changes for collections that don't opt in.
2. **Admin metadata, not content.** `order_key` lives on the logical-document row (`byline_documents.order_key`), not on `documentVersions`. Reordering does **not** create a new document version, does **not** flow through patches, and does **not** trigger collection write hooks.
3. **Fractional-index, no rebalancing.** Keys are base-62 strings that sort lexicographically (Greenspan's algorithm, [Observable article](https://observablehq.com/@dgreensp/implementing-fractional-indexing)). Inserting between two rows produces a new string strictly between their keys — no rebalancing pass, no global re-write.

## Enabling on a collection

```ts
// apps/webapp/byline/collections/team-members/admin.tsx
import { defineAdmin } from '@byline/core'

export const TeamMembersAdmin = defineAdmin(TeamMembers, {
  columns: listViewColumns,
  orderable: true,
})
```

When `orderable: true`:

- The list view default sort becomes `order_key` ascending (caller can still re-sort by any other column with the column-header sort UI; that disables drag-to-reorder until the sort is cleared).
- A drag-handle column appears on the left of each row in the list view.
- New documents (and duplicates) get an append-at-end `order_key` automatically.
- The `reorderCollectionDocument` server fn becomes meaningful for this collection; it rejects with `ERR_VALIDATION` on non-orderable collections.

## What lives where

| Concern                           | Where                                                                       |
| --------------------------------- | --------------------------------------------------------------------------- |
| The column                        | `byline_documents.order_key varchar(128) NULL`                              |
| The sort index                    | `idx_documents_collection_order` on `(collection_id, order_key)`            |
| Append-at-end on create/duplicate | `document-lifecycle.ts` → `maybeAppendOrderKey`                             |
| Drag-to-reorder UI                | `host-tanstack-start` → `admin-shell/collections/list.tsx`                  |
| Reorder API                       | `host-tanstack-start/server-fns/collections/reorder.ts`                     |
| Key generator                     | `@byline/core` → `generateKeyBetween`, `generateNKeysBetween`               |
| Default sort wiring               | `getCollectionDocuments` (list server fn) consults admin config             |
| Sort allowlist                    | `DOCUMENT_SORT_COLUMNS` in `parse-where.ts` (`orderKey` / `order_key`)      |

## Why a column on `byline_documents`, not elsewhere

- **Not per-version (`documentVersions`)** — reordering 50 rows shouldn't mint 50 versions, and if draft and published versions diverged there's no sensible "which version's order wins?" Order is single-valued per logical document.
- **Not EAV** — the EAV stores hold user-declared field values. `order_key` is system metadata, in the same category as `id` and `path` (which has its own table for locale variance).
- **Not a sidecar table (yet)** — a sidecar makes sense only if multiple ordering scopes emerge ("homepage order" vs. "sidebar order"). No real ask on file. The column-now / sidecar-later path is clean: a future `document_orderings(document_id, scope, order_key)` table layers on top with the existing column as the default scope.

## Backfill on adoption

Existing rows in a newly-`orderable` collection start with `order_key = NULL`. The list-view sort is `ORDER BY order_key ASC NULLS LAST, created_at DESC`, so unkeyed rows fall to the bottom in a stable order until the editor drags them. No migration-time backfill needed — adoption is gradual and editor-driven.

## Drag-to-reorder semantics

The admin list view uses `dnd-kit` with the vertical-list strategy. Each drop fires a single `reorderCollectionDocument` call carrying the dragged document and its new neighbours' IDs; the server resolves their `order_key`s in one query and writes a new key strictly between them via `generateKeyBetween(left, right)`.

Drag is **disabled** (handle dimmed, not interactive) when:

- A search query is active.
- A status filter is active.
- An explicit sort column other than `order_key` is selected.

In any of those views the visible row order is not the canonical stored order, so "drop between A and B" would map to the wrong neighbour IDs.

Reordering across pages is also disabled in this iteration — only same-page drops are supported. Adjust page size if a multi-page move is needed in the meantime.

## Auth

`reorderCollectionDocument` runs through `assertActorCanPerform(requestContext, collectionPath, 'update')`. No new ability slug — reorder is a metadata-level update of the document, so the existing `collections.<path>.update` ability is what's enforced.

`beforeRead` row-scoping applies to the list-view fetch the same way it does today (the reorder UI consumes whichever rows the actor is allowed to see), so a multi-tenant collection that scopes by `tenantId` keeps drag-to-reorder per-tenant.

## Orthogonality with `hasMany`

`hasMany` relation arrays carry their own order in the field value (array positions inside `store_relation`). The drag-handle on a `hasMany` picker reorders array entries inside a single document's content — that's a content edit and mints a new document version.

`orderable: true` is the orthogonal axis: the canonical sort of the **collection's documents** independent of any single field's value. Both can be used together: a `sections` collection can be `orderable: true` (root order) while each section document carries a `children: relation(hasMany)` field (per-section order).

## What is intentionally NOT in scope

- **Bulk reorder API.** Single-row reorder covers the drag-drop UX. Bulk insert lands via `generateNKeysBetween` if a real need arrives.
- **Cross-page drops.** Same-page only in v1.
- **Per-locale ordering.** `order_key` is one value per logical document. Defer to a sidecar table if anyone asks.
- **Reorder-versioning.** Order changes are not recorded in document history.
