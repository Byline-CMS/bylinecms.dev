---
title: "UI Kit (@byline/ui)"
path: "uikit"
summary: "The shared @byline/ui component library: primitives, themed surfaces, design tokens, and the Rslib build pipeline used to ship it to admin and downstream consumers."
---

# UI Kit (@byline/ui)

Companions:
- [Getting Started](../01-getting-started/index.md) — onboarding flow that pulls in `@byline/ui` styles and components.
- Companion project: [github.com/infonomic/uikit](https://github.com/infonomic/uikit) — the sibling kit this package shares its foundational components and stylesheets with.

## Overview

`@byline/ui` is Byline's **framework-agnostic React primitives package**: `Button`, `Card`, `Modal`, `Input`, `Drawer`, `Table`, `Search`, `Datepicker`, every icon, every loader, plus the cascade-layered stylesheet system and a generic `DraggableSortable` over `@dnd-kit/sortable`. This foundational surface is **shared with** [`@infonomic/uikit`](https://github.com/infonomic/uikit), the sibling open-source project the Byline maintainers also author. The two kits are kept in step by porting changes manually, in whichever direction a change originates: neither copy is the sole source of truth, and the shared files in this package may be edited directly.

:::note[What changed in v2.6.0]
Earlier versions of `@byline/ui` also carried Byline-specific surfaces: the document-editor form runtime, field widgets, admin layout primitives, and editor-shared widgets (status badge, diff modal). Those moved to `@byline/admin` in v2.6.0 because they embed CMS concepts (`CollectionDefinition`, `CollectionAdminConfig`, `DocumentPatch`, workflow status) and had no non-admin consumers. The reshape leaves `@byline/ui` as a true primitives package; the admin-aware surface is now `@byline/admin/react`. See the v2.6.0 release notes for the full symbol-move list.
:::

## Why a single package

Earlier iterations of Byline depended directly on `@infonomic/uikit` as a runtime peer. That worked, but it meant:

- Two repos in the "getting started" mental model.
- CSS imports and Tailwind glob configuration that referenced both packages by name.
- Brand inconsistency: every consumer's `node_modules` carried the `@infonomic/uikit` lockfile entry; admin DOM classes carried the upstream prefix.

Folding the foundational surface into `@byline/ui` cleans up all three. The companion package stays as the design-and-development home for the primitives (the place where new components are built, refined, and tested in Storybook), but Byline ships a single, self-contained UI dependency.

## Philosophy of the upstream kit

A short summary of what `@infonomic/uikit` is opinionated about, paraphrased from its [README](https://github.com/infonomic/uikit/blob/main/packages/uikit/README.md). These shape what Byline inherits.

- **CSS Modules over utility-first frameworks for the kit itself.** The kit composes styles in CSS Modules so consumers can use Tailwind, vanilla CSS, or any other system *on top of* the kit without fighting a utility-first style budget inside the components. The argument is that atomic CSS belongs in application layout and one-off styling; component libraries should ship semantic, overridable styles.
- **Wrap best-in-class headless primitives.** Many components (Modal, Tabs, Menu, Tooltip, Select, etc.) are built on [Base UI](https://base-ui.com/), with Day Picker for calendars and a few other carefully chosen primitives elsewhere. The kit's job is to give consumers a *stable contract* (variant, intent, sizing) so a future swap from one headless library to another doesn't break the consumer's API.
- **Framework-agnostic style system.** The CSS layer machinery is designed to work with React, Vue, Solid, Svelte, Astro, or plain HTML. Byline currently consumes only the React entry point, but the kit's structure leaves room for a Vue or Svelte adapter without restructuring the styles.
- **Style overrides without `!important`.** Named cascade layers let host restyles override kit defaults while directly applied Tailwind utilities retain final precedence for ordinary declarations.
- **Variant *and* intent as separate axes.** Variant is shape (`outlined`, `filled`, `gradient`, `underlined`); intent is semantic (`primary`, `secondary`, `noeffect`, `info`, `success`, `warning`, `danger`). Most components accept both. Intent-based design tokens (`--fill-primary-strong`, `--text-on-danger-weak`, etc.) follow an `element-intent-emphasis-state` taxonomy.
- **A `.not-dark` escape hatch.** Components can opt out of the inherited light/dark mode without rewriting the theme.

For the full rationale and design-system architecture, see the upstream [README](https://github.com/infonomic/uikit/blob/main/packages/uikit/README.md).

## CSS cascade layers (byline-prefixed)

A direct Tailwind utility wins an ordinary declaration on the same element and
property. This is a cascade-order contract, rather than selector specificity.
Inherited values do not override a declaration on a child. Conflicting utility
classes follow Tailwind's generated order, not their order in `className`.
`@apply` has the precedence of the layer where it is written; `@utility` is
emitted into Tailwind's utilities layer. Inline styles, important declarations,
animations and transitions are outside this ordinary-declaration guarantee.
Important declarations reverse layer priority, so `!important` is not an
appropriate general repair for incorrect layer placement.

Every stylesheet in the UI, admin, host, Lexical, AI and i18n packages reserves this complete order, from low to high precedence:

```css
@layer base, byline-base, theme, byline-theme, byline-functional,
  byline-typography, components, byline-components, overrides,
  byline-utilities, utilities;
@layer byline-components.primitives, byline-components.cms;
```

Site components and CSS modules belong in `components`. Host rules that restyle
kit components belong in `overrides`, above `byline-components`. Brand tokens
also belong in `overrides`, scoped to the area they theme. Avoid ordinary
unlayered rules: they outrank every named layer, including utilities. Exceptions
such as reduced-motion preferences need a stated reason and a source-test
allowlist. CSS Modules change class names; they do not create a cascade layer.

### Host integration

Use the independent `@byline/ui/css-layers` entry. It imports neither React nor
the component graph at runtime. Its PostCSS helper needs PostCSS 8 (already used
by Vite); install `postcss` as a development dependency if your host does not
already expose it. Merge the plugin into existing PostCSS configuration.

```ts
import { bylineLayerOrder } from '@byline/ui/css-layers'
import { defineConfig } from 'vite'

export default defineConfig({
  css: { postcss: { plugins: [bylineLayerOrder()] } },
})
```

Also render the shared statement early in the document head:

```tsx
import { BYLINE_LAYER_ORDER } from '@byline/ui/css-layers'

<head>
  <style>{BYLINE_LAYER_ORDER}</style>
  <HeadContent />
</head>
```

Keep both declarations. The head statement covers injected development CSS.
React can hoist production stylesheet links above that style, so the PostCSS
plugin puts the statement in every possible first stylesheet, before the bundler
hashes it. Repeating the same order is harmless; declaring a missing slot after
other layers have appeared cannot reposition it. Check the first appearance of
layer names in production output: minifiers may fold statements into layer
blocks without changing their order.

### Public themes and CMS isolation

Set a host-owned theme-context attribute on the document root during rendering,
including SSR. Derive it from the route boundary rather than waiting for an
effect. Apply public overrides only to that context so the CMS and its body
portals retain the standard kit theme. For example:

```css
@layer overrides {
  @scope (:root[data-theme-context="public"]) {
    :scope { --theme-base: oklch(0.55 0.084 144.28); }
    :scope.dark { --prose-body: var(--gray-100); }
    .byline-button { border-radius: 0; }
  }
}
```

Use `:scope` to select the root inside `@scope`; use `:scope.dark` for a dark
class on that same root. Defining tokens on a descendant wrapper is insufficient
when Tailwind's colour aliases resolve those tokens on the root before inheritance.
The context names are a host convention; Byline does not require this exact name.

The primitive sublayer holds kit components; the later CMS sublayer holds admin,
host, Lexical, AI and i18n component styles. This preserves CMS precedence over
primitives while allowing host overrides and direct utilities to win. Do not put
ordinary rules directly in `byline-components`: direct parent-layer rules outrank
both sublayers.

### Upgrading existing hosts

CMS layering changes observable behavior. Previously, unlayered CMS rules could
beat host utility classes. Those utilities now win on the same element and
property. Conversely, any remaining unlayered host rule now beats layered CMS
styles, regardless of specificity. A global `button` or `a` rule can therefore
change CMS controls after an upgrade.

Before upgrading, audit all host stylesheets, including CSS modules. Put ordinary
site rules in `components`, kit restyles in `overrides`, and public brand tokens
and global typography inside the public theme context. Add both integrations
above, then compare public and CMS screens, dialogs and editor fields in light
and dark modes. The helper establishes order; it does not wrap host or third-party
styles automatically. Installing the packages alone does not complete this
migration. The example app now scopes its public typography overrides by route
context; this is not a complete migration of all its public component CSS. Existing sites such as bylinecms.app and modulus-learning.org need
their own host audit and visual sign-off.

The source guard covers package CSS, not every style generated at runtime.
CodeMirror owns its internal layout, syntax highlighting and injected theme
styles. Its selection-color `!important` is an explicit exception so the Byline
selection token beats CodeMirror's selection rules. Use the `--byline-code-*`
tokens to theme these internals; the ordinary utility guarantee applies to the
surrounding CMS controls, not CodeMirror-generated elements. Inline positioning
from overlay and drag libraries is likewise outside the contract.

### Verification

Run `pnpm --filter @byline/ui test` for source and integration checks. After
building the six styled packages, run `pnpm --filter @byline/ui test:css-build` to check the
published helper and every emitted package stylesheet. The example provides a manual,
database-free browser fixture through `pnpm --filter @byline/webapp preview:css-contract`
at `http://127.0.0.1:5574/tests/css-layers/index.html`. Check both contexts/themes,
mobile and desktop widths, and toggle utilities to compare defaults. This is a
manual fixture, not an automated browser test or CI gate.
Hosts should also check their
production chunks and verify representative components in a browser: apply
spacing, width, background and typography utilities, and compare both themes,
responsive widths and portalled content against a visual baseline.

The layer prefix is `byline-`, not `infonomic-`, even though these files are shared with the companion kit. Every `@layer infonomic-*` declaration is renamed to `@layer byline-*` when a change is ported across. The DOM-level `:global(.infonomic-X)` class hooks (paired with `className="infonomic-X"` in the components) are deliberately *not* renamed: they're a separate surface, intended for consumer-side theme overrides keyed by the companion kit's stable class names.

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

Plus `src/uikit.ts`, the companion kit's `react.ts` barrel under a Byline name. Byline's `src/react.ts` re-exports from `./uikit.js` and adds the dnd helpers. The Byline-specific admin surface that once lived here (the form runtime, field widgets, admin layout primitives) moved to `@byline/admin` in v2.6.0; see the note above.

The companion kit also carries files that have no place here and are never ported across: `*.astro` entrypoints (Byline ships no Astro components), the `theme/` subtree (unused here), `*.stories.*` (Storybook lives there), and `__tests__/` / `*.test.*`.

The Byline-owned `dnd/` subtree exists only in this package and has no companion counterpart. (The former `admin/`, `fields/`, `forms/`, and `services/` subtrees moved to `@byline/admin` in v2.6.0.)

## Keeping the two kits in step

The shared subtrees are maintained by **porting changes manually, in whichever direction a change originates**. A fix or new component authored here is copied into `@infonomic/uikit`; one authored there is copied here. Either copy may be edited directly, and neither is the sole source of truth, so a change made in this repository (such as a new icon or a component fix) does not wait on an upstream release to land.

Two mechanical points to preserve when porting:

- **CSS layer prefix.** Rename every `@layer infonomic-*` declaration to `@layer byline-*` when copying a stylesheet in (and back the other way when copying out). The `:global(.infonomic-X)` class hooks are left as-is (see the cascade-layer section above).
- **The `uikit.ts` barrel.** This file mirrors the companion kit's `react.ts` export list. When the shared surface gains or loses an export, update `uikit.ts` to match; `src/react.ts` re-exports it, so a missing line there is a build error.

An earlier one-way sync script (`sync-from-uikit.sh`) mirrored the companion kit over these subtrees wholesale. It was removed once maintenance became bidirectional, because a wholesale mirror would discard any change authored on this side that had not yet been ported the other way.

## Public API

Byline ships the kit through a small set of subpath exports:

| Specifier | Surface | Source |
|---|---|---|
| `@byline/ui/css-layers` | Shared layer statement and PostCSS plugin | Byline-owned |
| `@byline/ui/react` | Every primitive React component + generic `DraggableSortable` | synced |
| `@byline/ui/reset.css` | Browser reset stylesheet | synced |
| `@byline/ui/styles.css` | Core token system + cascade layers | synced |
| `@byline/ui/typography.css` | Optional typography (prose, fonts) | synced |

The `/react/` segment is intentional: it leaves room for a future `/vue/` or `/svelte/` namespace if a non-React adapter ever ships, without breaking existing imports. A single barrel (rather than per-area subpaths) dodges the Vite `optimizeDeps` Context-identity trap. See the comment at the top of `packages/ui/src/react.ts`.

Byline-owned admin surfaces (`FormRenderer`, `FieldRenderer`, every per-type field widget, `AdminGroup` / `AdminRow` / `AdminTabs`, `StatusBadge`, `DiffModal`, `BylineFieldServicesProvider`, `LocalDateTime`, `DateTimeFormatter`, `useFormContext`, `useFieldValue`) live in **`@byline/admin/react`**. See [Collections](../04-collections/index.md) and [Fields](../04-collections/01-fields.md) for the import patterns.

## Consumer setup

In a consumer app's root CSS:

```css
@import "@byline/ui/reset.css";
@import "@byline/ui/styles.css";
@import "@byline/ui/typography.css";  /* optional */

@import "./tailwind.css";              /* optional, after the above */
@import "./app.css";                   /* application styles */
```

In components (primitives from `@byline/ui/react`, admin-aware components from `@byline/admin/react`):

```tsx
// Generic primitives — Button, Modal, Search, etc.
import { Button, Card, Container, Search } from '@byline/ui/react'

// Admin-aware surfaces — field widgets, form runtime, editor-shared widgets.
import { FormRenderer, LocalDateTime, DateTimeFormatter } from '@byline/admin/react'

// Admin services Context — providers + hooks for the document editor.
import { BylineFieldServicesProvider, useBylineFieldServices } from '@byline/admin/react'
```

Tailwind integration mirrors the upstream pattern. See the [upstream README](https://github.com/infonomic/uikit/blob/main/packages/uikit/README.md#tailwind-css-integration) for the full `@theme` block and the optional ShadCN compatibility layer (both apply unchanged to `@byline/ui`).

## License and credit

`@byline/ui` is MPL-2.0. The synced foundational surface originates in `@infonomic/uikit`, which is MIT-licensed. The Infonomic copyright headers are preserved in the synced files; the upstream LICENSE file is reproduced in the Byline repo as part of the sync content where applicable.

If you find a bug or want a new component in the foundational kit, contribute upstream at [github.com/infonomic/uikit](https://github.com/infonomic/uikit): the change will land in Byline on the next sync.
