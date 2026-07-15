---
title: "Client-config registration"
path: "client-config-registration"
summary: "Why the Byline client config is registered from two points on the _byline route, the root cause that blocks collapsing it to one eager point, and whether an eager single-point registration is even possible given that custom slot components need React context."
---

# Client-config registration

**The goal in one sentence:** keep Byline's **admin-area** JavaScript and
bundles — the document editor, field widgets, the richtext/AI editors, the
whole admin UI — from *leaking* into the **public surface** of the host
application. A visitor loading a public page (a marketing route, a blog post)
should never download the admin editor. Everything below is in service of that
boundary: the admin graph stays code-split behind the `_byline` routes, and the
client config that references it is registered carefully so the admin code is
pulled in *only* on admin routes.

This doc covers how `apps/webapp/byline/admin.config.ts` (the browser/SSR
**client** config) is registered, why it's registered from **two** points
today, the root cause that blocks collapsing those to a single eager point,
and — the load-bearing question — whether an eager single-point registration is
even possible given that custom slot components legitimately need React context.

Companions:
- [Core Composition](../03-architecture/02-core-composition.md) — the *server* composition story (`initBylineCore()`); this doc is the *client* config analogue.
- [Rich Text](../04-collections/06-rich-text.md) — the richtext editor slot, which was the first heavy slot made lazy (the `lexicalEditor` factory; see also `@byline/richtext-lexical/config`).

:::note
Byline registers the client config from two points today. Collapsing that to a
single eager registration is *possible* but blocked from being worthwhile by the
admin-presentation-barrel coupling described below — see the
[verdict](#verdict-possible-context-safe-but-not-currently-worth-it).
:::

---

## What the client config is

`byline/admin.config.ts` calls `defineClientConfig(config)` as a module
side-effect. That config does **two structurally different jobs**:

1. **Config *data* — React-free, lightweight.** Collection definitions, field
   types, column metadata (field name, label, sortable), routes, the i18n
   bundles. This is the part `getClientConfig()` consumers read at the loader
   phase.
2. **Config *component bindings* — live React references.** The slots that hold
   actual components:
   - `fields.<type>.editor` — a `RichTextEditorComponent` (the richtext field).
   - `columns[].formatter` — a `ColumnFormatter`: either a plain
     `(value, document) => ReactNode` function or a `{ component }` wrapper
     (`packages/core/src/@types/admin-types.ts`).
   - `listView` — a full custom collection-index component
     (`ListViewComponentProps`), e.g. the media collection's `MediaListView`.
   - per-field admin overrides (`aiRichTextAdmin()`, etc.).

The whole Phase 3 problem lives in the tension between these two jobs: **the
data wants to register eagerly; the component bindings drag heavy React code
when they do.**

## Why registration wants to be eager

`defineClientConfig` must have run before anything reads `getClientConfig()`.
On the `_byline` route two distinct lifecycle moments need it, and TanStack
Start covers them differently:

- **Loader phase.** A `_byline/*` child loader (e.g. the admin dashboard
  loader) calls `getClientConfig()`. A parent route's `beforeLoad` resolves
  before its children's loaders run, so registering there closes the race. On
  the client there is no server-config fallback, so an unregistered read throws
  *"Byline has not been configured yet."*
- **Component render / initial hydration.** On initial hydration TanStack Start
  reuses the dehydrated SSR result and does **not** re-run `beforeLoad` (or
  loaders), yet the admin layout component still calls `getClientConfig()` at
  render.

A *single* registration point can only cover both moments if it lives in a
module that is evaluated in **both** the loader-phase graph and the
component/hydration graph — i.e. an **eager** top-level import in the route
tree, evaluated before the router processes matches. That only works if the
imported module's static graph is light; otherwise every public route pays for
it.

## Current solution — dual registration

Because the config graph is **not** light (next section), the config is kept
code-split and registered from two complementary points on the `_byline` route,
both importing `byline/admin.config` and both calling `defineClientConfig`
idempotently (it evaluates once and is cached):

| Point | File | Covers |
|---|---|---|
| `beforeLoad` (dynamic `import()`) | `src/routes/_byline/route.tsx` | Loader phase — runs before any `_byline/*` child loader reads the config |
| side-effect `import` | `src/routes/_byline/route.lazy.tsx` | Component render / initial hydration — where `beforeLoad` is not re-run |

This is **correct and robust** — both guarantees hold reliably, and the dynamic/
lazy imports keep the heavy admin/editor graph out of public-route bundles. It
is only *awkward*: two entry points for one logical registration. There is **no
correctness bug** here; the eager single point is an elegance/maintenance goal,
not a fix.

Public frontend code does not participate in this registration. It imports plain
locale and route data through `byline/public.ts`; that facade re-exports the
`routes` object, whose `admin`, `api`, and `signIn` properties public code
canonicalizes with `resolveRoutes(routes)` without loading the admin config. Likewise, document route
modules only declare their route factory; the factory reads content-locale config
through `getClientConfig()` during its loader/component lifecycle, after the
parent `beforeLoad` or lazy-module registration has run. Route construction
therefore does not create an eager import path into `byline/i18n.ts`.

## Root cause — why the config graph isn't light

Two layers, only one of which is solved:

### 1. The editor runtime (solved)

`admin.config` referenced the richtext editor, which used to pull
`@byline/richtext-lexical`'s `.` barrel (statically re-exporting
`RichTextField` / `EditorField` / `Nodes` / every extension). **Shipped fix:**
the `@byline/richtext-lexical/config` subpath exports only `lexicalEditor` (a
factory that *dynamic-imports* the editor on first mount), the built-in
extension *names*, and the light toolbar-authoring primitives — no editor
runtime. `@byline/ai`'s `AiLexicalExtension` was likewise made statically
light (the AI drawer loads via dynamic import only). So **referencing the
editor no longer pulls it.**

### 2. The admin-presentation barrel (the actual blocker)

Every collection admin config statically imports presentation components from
`@byline/admin/react` — e.g. `DateTimeFormatter` (in *every* collection), and
`MediaListView` → `LocalDateTime`. `@byline/admin/react` is a **single,
deliberately indivisible barrel**. Its own header explains why:

> *per-area subpath exports break React Context identity under bundlers that
> pre-bundle subpaths individually (e.g. Vite's `optimizeDeps.include`) — a
> provider mounted on one Context identity and a hook reading another. A single
> specifier eliminates the trap structurally.*

The barrel `export *`s the whole admin **document-editor** surface — the four
React contexts (`FormContext`, `FieldServicesContext`, `AdminServicesContext`,
`NavigationGuardContext`), `FormRenderer`, `FieldRenderer`, every field widget,
`DiffModal`. The column formatters are held as **live references** by the
config objects (`columns[].formatter = DateTimeFormatter`), so they can't be
tree-shaken away. Therefore **eager-importing `admin.config` drags the entire
admin editing interface into public-route bundles** — the exact regression the
dual registration exists to avoid.

This generalises: **any** admin component wired into a column view or custom
slot has this effect whenever it comes from — or transitively imports —
`@byline/admin/react`. Light formatters that render off `@byline/core` types
only (e.g. `FeaturedFormatter`, `MediaThumbnail`) do *not*; the determining
factor is "does this slot's import graph reach `@byline/admin/react`?", not
"is it a formatter."

## The wrong framing (and why "extract light components" fails)

The tempting fix — "extract the formatters into a light subpath so the config
can reference them without the editor surface" — does **not** work for real
slots, and this is exactly the concern that motivated this doc: **custom slot
components legitimately want React context.** `MediaListView` needs i18n,
`LocalDateTime`, the pager, and the field-services Context; a custom field
editor needs `FormContext`. You cannot make those context-free, and you cannot
move the context modules into a separate light subpath without **re-introducing
the multi-Context-identity trap** the single barrel exists to prevent (two
copies of `createContext` → provider and hook reading different objects).

So "package the slot components lighter" is a dead end for anything non-trivial.

## The viable framing — defer *when* code loads, not *where* it renders

The key insight: **lazy loading changes when a component module evaluates; it
does not change where the component renders in the React tree, nor which
contexts it can read.** A slot component — however its code is loaded — renders
where its slot is mounted: inside the admin shell, inside `FormProvider` /
`FieldServicesProvider` / `AdminServicesProvider` / the i18n provider. It still
imports its hooks from the same single `@byline/admin/react` specifier, which
resolves to the same context objects the providers already mounted.

That decouples the two concerns cleanly:

- **Bundle weight (Phase 3 blocker)** → solved by making the config hold
  *deferred* slot bindings instead of eagerly-evaluated component modules.
- **Context identity (why the barrel is indivisible)** → untouched. Lazy
  loading a component from the same barrel does not duplicate the context
  modules; the single-specifier rule still holds.

So the answer to *"is this even possible, given slot components need
context?"* is **yes** — because the fix isn't to strip context from slot
components, it's to stop *eagerly evaluating their code at registration time*.
Context access at render time is unaffected.

### Mechanism sketches

All three keep `@byline/admin/react` a single barrel and keep context access
intact; they differ in ergonomics.

**A. Deferred slot bindings (lazy component references).** The config holds a
thunk, not an evaluated module:

```ts
// instead of: import { DateTimeFormatter } from '@byline/admin/react'
//             columns: [{ field: 'createdAt', formatter: DateTimeFormatter }]

columns: [{ field: 'createdAt', formatter: lazyFormatter(() => import('@byline/admin/react').then(m => m.DateTimeFormatter)) }]
```

`admin.config`'s static graph stays light (only thunks); the admin barrel loads
as one shared chunk the first time any admin route renders a deferred slot.
Cost: the admin render layer must wrap slot rendering in `Suspense` (the list
cell / slot host), and the authoring API gains a wrapper. Note the dynamic
`import('@byline/admin/react')` deliberately pulls the *whole* barrel as one
chunk — correct for context identity, and acceptable because it only loads on
admin routes.

**B. Descriptor / registry tokens.** The config carries a React-free token
(`formatter: dateTime()` → `{ kind: 'datetime' }`); the admin route owns a
registry that resolves tokens to the real (lazily-loaded) components. Fully
decouples config *data* from component *code*; custom components register into
the admin-route registry (`registerFormatter('media-thumb', () => import('./media-thumbnail'))`).
Strongest separation, largest API change.

**C. Split registration by realm.** Register the React-free config *data*
eagerly (single point — race + hydration gap gone for the part that the loader
phase actually reads), and register the component *bindings* from inside the
`_byline/admin` subtree (lazy, where the barrel is already loaded). This mirrors
the existing schema-vs-`defineAdmin` split, taken one level further: admin
*config metadata* (eager-safe) vs. admin *component bindings* (admin-route-only).

Each preserves: single barrel (context identity), context access at render
(slots still mount inside the provider tree), and no editor/admin surface in
public bundles (component code is behind a dynamic boundary).

## Verdict — possible, context-safe, but not currently worth it

An eager single-point registration **is** achievable without breaking context
access. But weigh it honestly:

- **Benefit:** removes two import statements that already work correctly. No
  correctness or robustness gain — the dual registration's guarantees are
  reliable.
- **Cost:** reworks the formatter/`listView`/editor *authoring* API for
  deferral, adds `Suspense` plumbing across the admin list/slot render layer,
  and touches every collection admin config — for a DX regression (slots become
  thunks/tokens instead of plain imports).

That trade is poor today. **Recommendation: keep the dual registration; defer
the eager single point until a concrete driver makes eager-light config
genuinely *necessary*** rather than merely tidier. Candidate drivers:

- A non-admin/public or SSR surface needs client-config data that cannot be
  represented by the plain `byline/public.ts` boundary — at which point
  eager-light registration stops being elegance and becomes a requirement.
- The loader/hydration registration ever proves flaky in practice (it has not).
- The slot/formatter API is being reworked anyway for another reason, making
  the deferral change marginal.

If a driver lands, **mechanism C** (split data-vs-bindings registration) is the
recommended starting point: it gives the eager single point for the data half
without forcing every slot author onto a deferral wrapper, and it keeps the
context guarantees structural rather than convention-based.

## Touch points (for whoever picks this up)

- `@byline/admin` packaging + the slot-render layer (`fields/column-formatter.tsx`,
  the collection-index list view) for `Suspense` boundaries.
- `apps/webapp/byline/admin.config.ts` and the collection `admin.tsx` files
  (slot authoring shape).
- `src/routes/_byline/route.tsx`, `route.lazy.tsx` (retire one point), and the
  registration comments in `client.tsx` / `admin.config.ts` / `CLAUDE.md`.
