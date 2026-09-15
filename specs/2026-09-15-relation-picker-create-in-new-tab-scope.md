# Relation picker: create the target in a new tab

A small alternative to embedded relationship creation. The editor opens the target
collection's ordinary create view in a **new browser tab**, leaving the parent editor and
the picker mounted and unsaved, then returns and refreshes the picker to find and select
the new document.

Supersedes, for now, the embedded creation feature designed in
[`2026-09-14-embedded-relation-creation-spec.md`](./2026-09-14-embedded-relation-creation-spec.md)
and planned in
[`2026-09-14-embedded-relation-creation-plan.md`](./2026-09-14-embedded-relation-creation-plan.md).
Those documents stand as the fuller design; see the decision note in each.

## The problem this solves, and the one it does not

The friction today is not that the create page is hard to reach. It is that reaching it
costs the editor their unsaved work: they must either abandon the parent document or save
it, and saving mid-edit may be impossible — an incomplete document can fail validation on
fields unrelated to the one being filled in. Requiring a save can therefore block the very
workflow the affordance is meant to support.

Opening in a new tab removes that cost: the parent form, its unsaved values and the open
picker all survive untouched.

A newly created document follows the ordinary lifecycle and starts at its collection’s
configured default status. A workflow whose default is draft still requires publication;
`SINGLE_STATUS_WORKFLOW` creates directly at published status. This is the same behavior
as navigating to the ordinary create view.

## Why this is small

Selection continues to come from the **list response**, which already carries the target
collection's identity (`relation-picker.tsx` reads `response.included.collection.id`). The
embedded design needed additive create outcomes, creation receipts, uncertain-outcome
handling and selection-failure recovery precisely because it bypassed the list. Routing
creation back through the list does not defer that machinery — it removes the need for it.

## Scope

### 1. Host-supplied capability

Two optional members on `BylineFieldServices`
(`packages/admin/src/fields/field-services-types.ts:114`), following the existing
convention there — optional, with the widget guarding on their presence, so a host that
wires neither simply gets no affordance:

```ts
/**
 * Whether the viewer may create documents in this collection. Cosmetic: the
 * server enforces the ability on the create page regardless.
 */
canCreateInCollection?: (collectionPath: string) => boolean
/**
 * Root-relative URL of the collection's create view, built from the host's configured
 * admin path. Root-relative deliberately: an origin lookup is not available during SSR,
 * and `getAdminRoutePath` already returns exactly this shape.
 */
getCreateDocumentUrl?: (collectionPath: string) => string
```

The host supplies both. `@byline/admin` must not hardcode `/admin/...`: the admin base path
is host configuration, and `@byline/admin` may not import TanStack routes. The ability check
comes from the host's existing `useAbility` (`packages/host-tanstack-start/src/integrations/abilities.tsx`),
which reads route context and is already documented there as cosmetic.

### 2. Create affordance in the picker

- Labelled from the target collection's singular label.
- Opens `getCreateDocumentUrl(targetCollectionPath)` in a new tab.
- Rendered only when both capabilities are present **and**
  `canCreateInCollection(targetCollectionPath)` is true. No knowingly unauthorised link.
- Must not submit, dismiss or otherwise disturb the parent form or the picker.

### 3. Explicit Refresh

- Re-runs the current query, preserving search text, page and current selections.
- **Implemented as a nonce in the fetch effect's dependency array**, not as an imperative
  refetch. The effect's existing `cancelled` cleanup flag (`relation-picker.tsx:157,202`)
  then drops a late response from a superseded request; an imperative refetch outside the
  effect would lose that protection.

### 4. Finding the new document

`media` sets `itemViewSort: { field: 'title', direction: 'asc' }`
(`apps/webapp/byline/collections/media/admin.tsx:107`), so a new item appears in
alphabetical position, **not** at the top. With search text or a page offset preserved it
may not be in the visible results at all. Ordinary search and pagination are the route to
it. Do not promise "refresh and it is first", in copy or in documentation.

### 5. Translations and documentation

New keys in all eight bundled locales (`en`, `fr`, `de`, `es`, `it`, `ko`, `th`, `zh-CN`) —
`packages/i18n/src/admin/index.test.node.ts` enforces parity. Update the relationships
documentation to describe the workflow.

## Review checklist

- Creation opens separately without submitting or dismissing the parent, and unsaved parent
  values survive.
- The affordance respects permissions and the host's configured admin path; it is absent
  when the host wires no capability.
- Refresh preserves search, page and selections, and a stale response cannot overwrite a
  newer result.
- A newly created draft can actually be found and selected, using search or pagination.
- Keyboard operation, translations and error handling.

## Revisiting embedded creation

Reopen when real editing sessions show this interruption is frequent and costly enough to
justify the larger investment — at which point the choice is between the full generic
feature and a narrower media-specific one. The reference application's relation fields point
almost entirely at `media`, but that establishes what editors link to, not how often they
need to create it mid-edit.
