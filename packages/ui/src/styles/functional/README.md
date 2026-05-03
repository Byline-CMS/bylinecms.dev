# Functional Token Layer

This directory holds the **semantic source of truth** for the uikit. Every token here is defined in three scopes: `:root` (light), `.dark` / `[data-theme="dark"]` (dark), and `.not-dark` (a local override that forces light-mode tokens regardless of an ancestor `.dark` class).

Components must read from these tokens. They must not read base palette primitives directly unless there is no semantic equivalent.

## Files

- `colors.css` — intent token families (fill, text-on, text, stroke, ring, gradient × primary, secondary, noeffect, success, info, warning, danger), plus the generic `--focus-ring` role token.
- `surfaces.css` — `--background`, `--foreground`, `--surface-panel*`, `--surface-item*`, `--surface-subtle*`, scrollbar tokens.
- `typography.css` — `--text`, `--headings`, `--muted`, `--text-subtle`, `--text-placeholder`.
- `borders.css` — `--border-color`, field-state tokens (`--field-border`, `--field-border-hover`, `--field-border-invalid`, `--field-ring`, `--field-ring-invalid`).
- `grid-flex.css` — layout tokens.
- `shadcn-compat.css` — optional `--shadcn-*` alias namespace covering core surface/content roles, the radius scale (`--shadcn-radius{,-sm,-md,-lg,-xl}`), the five-slot chart palette (`--shadcn-chart-1`…`-5`), and the sidebar primitive (`--shadcn-sidebar*`). Mode switching is handled by the underlying functional tokens, so the aliases are defined once in `:root` only. Strictly for ShadCN-style Tailwind utilities in consumer apps; **do not use inside uikit components**.

## Intent Token Taxonomy

`--{element}-{intent}[-{emphasis}][-{state}]`

| Part | Values |
| --- | --- |
| element | `fill`, `text-on`, `text`, `stroke`, `ring`, `gradient` |
| intent | `primary`, `secondary`, `noeffect`, `success`, `info`, `warning`, `danger` |
| emphasis | `strong`, `weak`, `outlined`, `text` (present on `fill` and `text-on` tokens) |
| state | `hover`, `disabled` (present where a state-specific value is needed) |

There is **no `accent` intent family**. `--accent` is a raw brand palette token; prefer `--fill-primary-*` for emphasis surfaces or `--surface-subtle-*` for interactive neutral surfaces.

### Standard variants per intent

Every intent family provides these:

- `--fill-{intent}-strong`, `-strong-hover`, `-strong-disabled`
- `--fill-{intent}-weak`, `-weak-hover`, `-weak-disabled`
- `--fill-{intent}-outlined`, `-outlined-hover`, `-outlined-disabled`
- `--fill-{intent}-text`, `-text-hover`, `-text-disabled`
- `--text-on-{intent}-strong`, `-strong-hover`, `-strong-disabled`
- `--text-on-{intent}-weak`, `-weak-hover`, `-weak-disabled`
- `--text-on-{intent}-outlined`, `-outlined-hover`, `-outlined-disabled`
- `--text-{intent}`, `-weak`, `-hover`, `-disabled`
- `--stroke-{intent}`, `-hover`, `-disabled`
- `--ring-{intent}`
- `--gradient-{intent}-start`, `-end`, `-foreground`, `-disabled`

Noeffect additionally provides `--text-on-noeffect-text*` and `--gradient-noeffect-hover`.

## Generic Role Tokens

Use these when a component needs a role without adopting an intent:

| Token | Purpose |
| --- | --- |
| `--focus-ring` | Neutral focus ring when the component is not tied to an intent |
| `--field-border` | Default border on form fields |
| `--field-border-hover` | Hover border on form fields |
| `--field-border-invalid` | Invalid-state border on form fields |
| `--field-ring` | Default focus ring on form fields |
| `--field-ring-invalid` | Invalid-state focus ring on form fields |
| `--surface-subtle` | Subdued neutral surface |
| `--surface-subtle-hover` | Subdued neutral surface on hover / for interactive neutral highlight |
| `--surface-subtle-active` | Subdued neutral surface when pressed / active |
| `--text-subtle` | Subdued foreground text |
| `--text-placeholder` | Placeholder-style foreground text |

## Parity Contract

Every token defined in `:root` must also be defined in `.dark` and `.not-dark`, or it will silently fall back to the property's initial value in one of the modes. A Python parity check is in the repo history at `packages/uikit/src/styles/functional/colors.css` — if you add a new token, audit all three scopes before merging.
