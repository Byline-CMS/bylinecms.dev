---
title: "UI Kit (@byline/ui)"
path: "uikit"
summary: "The shared @byline/ui component library — primitives, themed surfaces, design tokens, and the Rslib build pipeline used to ship it to admin and downstream consumers."
---

# UI Kit (`@byline/ui`)

Companions:
- [Getting Started](../01-getting-started/index.md) — onboarding flow that pulls in `@byline/ui` styles and components.
- Companion project: [github.com/infonomic/uikit](https://github.com/infonomic/uikit) — the sibling kit this package shares its foundational components and stylesheets with.

## Overview

`@byline/ui` is Byline's **framework-agnostic React primitives package** — `Button`, `Card`, `Modal`, `Input`, `Drawer`, `Table`, `Search`, `Datepicker`, every icon, every loader, plus the cascade-layered stylesheet system and a generic `DraggableSortable` over `@dnd-kit/sortable`. This foundational surface is **shared with** [`@infonomic/uikit`](https://github.com/infonomic/uikit), the sibling open-source project the Byline maintainers also author. The two kits are kept in step by porting changes manually, in whichever direction a change originates — neither copy is the sole source of truth, and the shared files in this package may be edited directly.

:::note[What changed in v2.6.0]
Earlier versions of `@byline/ui` also carried Byline-specific surfaces — the document-editor form runtime, field widgets, admin layout primitives, and editor-shared widgets (status badge, diff modal). Those moved to `@byline/admin` in v2.6.0 because they embed CMS concepts (`CollectionDefinition`, `CollectionAdminConfig`, `DocumentPatch`, workflow status) and had no non-admin consumers. The reshape leaves `@byline/ui` as a true primitives package; the admin-aware surface is now `@byline/admin/react`. See the v2.6.0 release notes for the full symbol-move list.
:::

## Why a single package

Earlier iterations of Byline depended directly on `@infonomic/uikit` as a runtime peer. That worked, but it meant:

- Two repos in the "getting started" mental model.
- CSS imports and Tailwind glob configuration that referenced both packages by name.
- Brand inconsistency: every consumer's `node_modules` carried the `@infonomic/uikit` lockfile entry; admin DOM classes carried the upstream prefix.

Folding the foundational surface into `@byline/ui` cleans up all three. The companion package stays as the design-and-development home for the primitives — the place where new components are built, refined, and tested in Storybook — but Byline ships a single, self-contained UI dependency.

## Philosophy of the upstream kit

A short summary of what `@infonomic/uikit` is opinionated about — paraphrased from its [README](https://github.com/infonomic/uikit/blob/main/packages/uikit/README.md). These shape what Byline inherits.

- **CSS Modules over utility-first frameworks for the kit itself.** The kit composes styles in CSS Modules so consumers can use Tailwind, vanilla CSS, or any other system *on top of* the kit without fighting a utility-first style budget inside the components. The argument is that atomic CSS belongs in application layout and one-off styling; component libraries should ship semantic, overridable styles.
- **Wrap best-in-class headless primitives.** Many components (Modal, Tabs, Menu, Tooltip, Select, etc.) are built on [Base UI](https://base-ui.com/), with Day Picker for calendars and a few other carefully chosen primitives elsewhere. The kit's job is to give consumers a *stable contract* — variant, intent, sizing — so a future swap from one headless library to another doesn't break the consumer's API.
- **Framework-agnostic style system.** The CSS layer machinery is designed to work with React, Vue, Solid, Svelte, Astro, or plain HTML. Byline currently consumes only the React entry point, but the kit's structure leaves room for a Vue or Svelte adapter without restructuring the styles.
- **Style overrides without `!important`.** Cascade layers (`@layer`) are used so any consumer-side CSS — outside any layer — automatically wins specificity over the kit's component styles. This is the single most load-bearing decision in the kit's design.
- **Variant *and* intent as separate axes.** Variant is shape (`outlined`, `filled`, `gradient`, `underlined`); intent is semantic (`primary`, `secondary`, `noeffect`, `info`, `success`, `warning`, `danger`). Most components accept both. Intent-based design tokens (`--fill-primary-strong`, `--text-on-danger-weak`, etc.) follow an `element-intent-emphasis-state` taxonomy.
- **A `.not-dark` escape hatch.** Components can opt out of the inherited light/dark mode without rewriting the theme.

For the full rationale and design-system architecture, see the upstream [README](https://github.com/infonomic/uikit/blob/main/packages/uikit/README.md).

## CSS cascade layers (byline-prefixed)

The kit's stylesheets declare a strict layer order at the top of the cascade:

```css
@layer byline-base,
  byline-functional,
  byline-utilities,
  byline-theme,
  byline-typography,
  byline-components;
```

Each component CSS Module wraps its rules in `@layer byline-components { ... }`. Anything a consumer writes outside any `@layer` automatically wins specificity, so overrides are CSS-clean — no `!important`, no specificity ladders.

The layer prefix is `byline-`, not `infonomic-`, even though these files are shared with the companion kit. Every `@layer infonomic-*` declaration is renamed to `@layer byline-*` when a change is ported across. The DOM-level `:global(.infonomic-X)` class hooks (paired with `className="infonomic-X"` in the components) are deliberately *not* renamed — they're a separate surface, intended for consumer-side theme overrides keyed by the companion kit's stable class names.

## What's shared and what's not

Eight subtrees under `packages/ui/src/` are shared with the companion kit:

| Shared subtree | Contents |
|---|---|
| `components/` | Foundational React components (Button, Card, Modal, Input, etc.) |
| `icons/` | Icon components, including brand icons (Github, Google, Infonomic) |
| `hooks/` | Reusable React hooks (`useFocusTrap`, etc.) |
| `lib/` | Utilities used internally by components |
| `loaders/` | Loading/spinner components |
| `styles/` | Global stylesheets (`reset.css`, `styles.css`, `typography.css`) and the layer system |
| `utils/` | Helper modules referenced by components |
| `widgets/` | Higher-order widgets (Modal, Drawer, Datepicker, Search, Timeline) |

Plus `src/uikit.ts`, the companion kit's `react.ts` barrel under a Byline name. Byline's `src/react.ts` re-exports from `./uikit.js` and adds the dnd helpers; the four subsystem barrels (`admin.ts`, `fields.ts`, `forms.ts`, `services.ts`) carry the Byline-specific surface.

The companion kit also carries files that have no place here and are never ported across: `*.astro` entrypoints (Byline ships no Astro components), the `theme/` subtree (unused here), `*.stories.*` (Storybook lives there), and `__tests__/` / `*.test.*`.

The Byline-owned subtrees (`admin/`, `fields/`, `forms/`, `services/`, `dnd/`) exist only in this package and have no companion counterpart.

## Keeping the two kits in step

The shared subtrees are maintained by **porting changes manually, in whichever direction a change originates**. A fix or new component authored here is copied into `@infonomic/uikit`; one authored there is copied here. Either copy may be edited directly, and neither is the sole source of truth — so a change made in this repository (such as a new icon or a component fix) does not wait on an upstream release to land.

Two mechanical points to preserve when porting:

- **CSS layer prefix.** Rename every `@layer infonomic-*` declaration to `@layer byline-*` when copying a stylesheet in (and back the other way when copying out). The `:global(.infonomic-X)` class hooks are left as-is — see the cascade-layer section above.
- **The `uikit.ts` barrel.** This file mirrors the companion kit's `react.ts` export list. When the shared surface gains or loses an export, update `uikit.ts` to match; `src/react.ts` re-exports it, so a missing line there is a build error.

An earlier one-way sync script (`sync-from-uikit.sh`) mirrored the companion kit over these subtrees wholesale. It was removed once maintenance became bidirectional, because a wholesale mirror would discard any change authored on this side that had not yet been ported the other way.

## Public API

Byline ships the kit through a small set of subpath exports:

| Specifier | Surface | Source |
|---|---|---|
| `@byline/ui/react` | Every primitive React component + generic `DraggableSortable` | synced |
| `@byline/ui/reset.css` | Browser reset stylesheet | synced |
| `@byline/ui/styles.css` | Core token system + cascade layers | synced |
| `@byline/ui/typography.css` | Optional typography (prose, fonts) | synced |

The `/react/` segment is intentional: it leaves room for a future `/vue/` or `/svelte/` namespace if a non-React adapter ever ships, without breaking existing imports. A single barrel (rather than per-area subpaths) dodges the Vite `optimizeDeps` Context-identity trap — see the comment at the top of `packages/ui/src/react.ts`.

Byline-owned admin surfaces — `FormRenderer`, `FieldRenderer`, every per-type field widget, `AdminGroup` / `AdminRow` / `AdminTabs`, `StatusBadge`, `DiffModal`, `BylineFieldServicesProvider`, `LocalDateTime`, `DateTimeFormatter`, `useFormContext`, `useFieldValue` — live in **`@byline/admin/react`**. See [`docs/Collections`](../04-collections/index.md) and [`docs/Fields`](../04-collections/01-fields.md) for the import patterns.

## Consumer setup

In a consumer app's root CSS:

```css
@import "@byline/ui/reset.css";
@import "@byline/ui/styles.css";
@import "@byline/ui/typography.css";  /* optional */

@import "./tailwind.css";              /* optional, after the above */
@import "./app.css";                   /* application styles */
```

In components — primitives from `@byline/ui/react`, admin-aware components from `@byline/admin/react`:

```tsx
// Generic primitives — Button, Modal, Search, etc.
import { Button, Card, Container, Search } from '@byline/ui/react'

// Admin-aware surfaces — field widgets, form runtime, editor-shared widgets.
import { FormRenderer, LocalDateTime, DateTimeFormatter } from '@byline/admin/react'

// Admin services Context — providers + hooks for the document editor.
import { BylineFieldServicesProvider, useBylineFieldServices } from '@byline/admin/react'
```

Tailwind integration mirrors the upstream pattern — see the [upstream README](https://github.com/infonomic/uikit/blob/main/packages/uikit/README.md#tailwind-css-integration) for the full `@theme` block and the optional ShadCN compatibility layer (both apply unchanged to `@byline/ui`).

## License and credit

`@byline/ui` is MPL-2.0. The synced foundational surface originates in `@infonomic/uikit`, which is MIT-licensed. The Infonomic copyright headers are preserved in the synced files; the upstream LICENSE file is reproduced in the Byline repo as part of the sync content where applicable.

If you find a bug or want a new component in the foundational kit, contribute upstream at [github.com/infonomic/uikit](https://github.com/infonomic/uikit) — the change will land in Byline on the next sync.
