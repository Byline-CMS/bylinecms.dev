# ISSUE (temporary): array fields inside blocks are structurally frozen in the admin

_Filed 2026-07-17 from the FORRU beta migration (beta.forru.org Wave 1
block porting). The FAQBlock added alongside this file is the repro._

## Symptom

An `array` field declared inside a block (e.g. FAQBlock's `faq` array,
TimelineBlock's `items`) renders its existing items' child fields in the
admin, but the editor cannot:

- **drag-reorder** items,
- **add** an item (no add-row renders), or
- **remove** an item (no per-item context menu renders).

Top-level `array` fields are unaffected (fully sortable + editable).
The same freeze applies to arrays inside plain top-level `group` fields
and to arrays nested inside another array's items.

## Root cause — two compounding defects

### 1. `GroupField` hardcodes `disableSorting={true}` for every child

`packages/admin/src/fields/group/group-field.tsx` (~line 103): every
child renders through `FieldRenderer` with `disableSorting={true}`.
`BlocksField` renders each block instance's children through a
synthesized `GroupField` (`blocks-field.tsx` ~line 240), so **every
array inside any block inherits it**. The hardcode predates the blocks
work (present since at least the admin extraction, `42da0577`) and was
carried through the `defineBlockAdmin` change (`57d998d7`) unexamined.

### 2. `ArrayField` conflates sorting with structural editing

`packages/admin/src/fields/array/array-field.tsx`: in the
`disableSorting` branch, items render as bare cards — no `SortableItem`
(whose header carries the add-below/remove `DraggableContextMenu`) —
and the **add-row only exists inside the `DraggableSortable` branch**
(~lines 287–316). So `disableSorting` doesn't just remove drag: it
removes all structural editing. Even where nested drag is deliberately
avoided, add/remove must still work.

## Why nested sorting is actually safe

- `DraggableSortable` (`packages/ui/src/dnd/draggable-sortable/`) is a
  dnd-kit `DndContext` + `SortableContext` with a `useId()`-scoped
  droppable — each instance is an independent context.
- `SortableItem` attaches `{...listeners}` **to the grip button only**,
  not the row, so an inner array's grip activates the inner context and
  the block's grip the outer one. Handle-scoped activation across
  nested `DndContext`s is exactly the arrangement Payload (this dnd
  code's ancestor) ships in production for arrays-inside-blocks.

## Proposed fix (two independent parts)

1. **`ArrayField`: decouple structural editing from sorting.** Always
   render the add-row and the per-item add-below/remove controls;
   `disableSorting` should only remove the drag affordance. Concretely:
   a `SortableItem` variant (or prop, e.g. `sortable={false}`) that
   renders the same header + `DraggableContextMenu` + collapse toggle
   without `useSortable`/grip, and hoist the add-row out of the
   `DraggableSortable` branch. This alone fixes "cannot add an FAQ
   item" at every nesting depth.

2. **`GroupField`: accept `disableSorting` instead of hardcoding it.**
   Add `disableSorting?: boolean` to `GroupFieldProps`, thread it to
   children, and have `BlocksField` pass `disableSorting={false}` on
   the synthesized group so arrays directly inside blocks become fully
   sortable. Open decision: default the prop to the current `true`
   (conservative — plain groups/array-nested groups keep today's
   behaviour) or to `false` everywhere, given handle-scoped listeners
   make nesting safe. `FieldRenderer`'s group branch should thread its
   own `disableSorting` through either way, so arrays inside groups
   inside array items keep the existing one-level-only behaviour under
   the conservative default.

## Repro / test

`apps/webapp/byline/blocks/faq-block.ts` (added with this file, ported
from the FORRU beta migration) is registered in the docs + pages
`content` blocks with a renderer at
`src/ui/byline/blocks/faq-block/index.tsx`:

1. `pnpm dev` → admin → any docs/pages document → add an **FAQ** block.
2. Observe: no add-row for `Questions`, no item context menu, no drag.
3. Compare with any top-level array field, which has all three.

Delete this file once the fix lands (and consider whether FAQBlock
stays as a reference block for arrays-inside-blocks or gets removed).
