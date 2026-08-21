# Admin Dashboard Collection Groups Design

Date: 2026-08-21
Status: design approved; not implemented

## Goal

Let an installation arrange its collections into labelled groups on the admin
dashboard, so that a site with many collections — content types, upload and
media libraries, authority or biography collections, counter-backed facet
collections — presents as a small number of comprehensible sections rather than
one undifferentiated grid of cards.

Alongside it, stop the dashboard from advertising collections the signed-in
administrator cannot read.

## Background: current state

The admin dashboard is the only surface that enumerates collections for
navigation. `AdminMenuDrawer`
(`packages/host-tanstack-start/src/admin-shell/chrome/admin-menu-drawer.tsx`)
lists Dashboard, Admin Users, Admin Roles, Permissions, and Activity — it
carries no collection links at all. `AdminDashboard`
(`packages/host-tanstack-start/src/admin-shell/chrome/dashboard.tsx:73`) maps
`getAdminConfig().collections` flat into a card grid. The only other consumer of
the collection list in the admin interface is the activity-log filter dropdown
(`packages/host-tanstack-start/src/admin-shell/admin-activity/list.tsx:82`).

Two existing facts shape the design.

**A vestigial slot already exists.** `CollectionAdminConfig`
(`packages/core/src/@types/admin-types.ts:231`) declares:

```ts
/** Group name for organising collections in the admin sidebar. */
group?: string
```

Nothing reads it — no validator, no renderer. It predates the rename of the
former admin `group` primitive to `AdminGroup` / `GroupDefinition` (commit
`e2908380`), and it survived the August 2026 configuration-surface cleanup that
deleted `CollectionAdminConfig.picker`
(`specs/2026-08-02-configuration-surface-breaking-cleanup-plan.md:352`). This
design revives that slot rather than widening the configuration surface.

**The dashboard shows collections the administrator cannot read, with
misleading counts.** The dashboard route loader
(`packages/host-tanstack-start/src/routes/create-admin-dashboard-route.tsx:26-36`)
fetches per-status counts for every collection whose definition sets
`showStats: true`. `getCollectionStats`
(`packages/host-tanstack-start/src/server-fns/collections/stats.ts`) routes
through `CollectionHandle.countByStatus`, which calls
`assertActorCanPerform(context, path, 'read')` and throws for an administrator
without that ability. The throw is swallowed twice — once inside
`getCollectionStats` (`stats.ts:48`) and once by the loader's own `catch` —
producing `statsMap[path] = []`.

The card therefore renders with every status tile reading `0`, which is
indistinguishable from a collection that is genuinely empty. Following the card
then fails at the list route. The present behaviour leaks the existence of the
collection and reports a false count.

## Decisions

Four questions were settled before this document was written.

### The group lives on the admin configuration, not the schema

Grouping is presentation. `CollectionDefinition` is the server-safe half of the
schema/presentation split, consumed by seeds, code generation, storage
flattening, and the markdown assembler, none of which have any use for a
dashboard heading. Placing `group` there would introduce the first purely
cosmetic property on that type.

The cost is that a collection with no admin configuration at all needs one in
order to be grouped. That is a two-line addition
(`defineAdmin({ slug: 'authors', group: 'authorities' })`) and is preferable to
eroding the split.

This also matches the shape of the prior art. Payload CMS exposes the same
capability as `admin.group` on its collection configuration; Byline's
`CollectionAdminConfig` is the direct analogue of Payload's `admin` block.

### Groups are declared in an ordered central registry and referenced by key

The alternative — a bare label string on each collection's admin configuration
— is shorter to write but carries three defects at the scale this feature
targets:

- **Display order would be implicit.** With labels scattered across N admin
  configurations, group order could only derive from first appearance in the
  `collections` array, so reordering the dashboard would mean reordering an
  unrelated array.
- **Typographical errors would fork groups silently.** `group: 'Authorities'`
  and `group: 'authorities'` would render as two headings with no diagnostic.
- **Labels could never be centrally translated or relabelled.**

A registry fixes the first two, makes the third possible later, and provides a
place to add `icon`, `description`, or `collapsed` additively.

### Ungrouped collections render first, in a heading-less band

When the registry is declared but a collection carries no `group`, that
collection appears in a leading band above the first group heading, with no
heading of its own.

This keeps incremental adoption workable — group a few collections, leave the
rest — and avoids burying primary content collections that simply have not been
categorised yet under a trailing "Other" heading. Nothing is ever hidden as a
result of being ungrouped.

### Group labels are plain strings; translation is deferred

`CollectionDefinition.labels.singular` and `labels.plural` are raw untranslated
strings today — `dashboard.tsx:89` renders `collection.labels.plural` directly,
with no `t()` call. Collection names on the dashboard are therefore already
rendered in the language the installation authored them in, regardless of the
active admin interface locale.

Giving group labels a bespoke translation mechanism would make a heading render
in French above card titles that render in English. Group labels are plain
strings for now, and translated group headings should arrive as part of one
uniform collection-level internationalization pass that also addresses
`labels.singular` / `labels.plural`.

### Dashboard cards are gated on `collections.<path>.read`

A card links to the collection list view and displays per-status counts. Both
require the `read` ability, and both are rejected server-side without it. `read`
is therefore the ability that determines whether the card is shown.

A role holding `create` but not `read` sees no card. That role is already
non-functional end to end — the create route redirects into the edit view on
success, and the edit view requires `read` — so this design does not attempt to
accommodate it. Making create-only roles usable is a separate defect, and is
not addressed here.

## Configuration surface

A new exported type in `packages/core/src/@types/admin-types.ts`:

```ts
/**
 * One labelled group of collections on the admin dashboard. Declared in
 * `AdminConfig.collectionGroups` and referenced by `name` from
 * `CollectionAdminConfig.group`.
 */
export interface CollectionGroupDefinition {
  /** Stable key referenced by `CollectionAdminConfig.group`. Boot-validated. */
  name: string
  /** Heading text rendered above this group's collections. */
  label: string
}
```

A new optional property on `AdminConfig`
(`packages/core/src/@types/site-config.ts:156`), declared alongside `admin` and
`blockAdmin`:

```ts
/**
 * Ordered registry of dashboard collection groups. Array order is display
 * order. Omit entirely to keep the flat, ungrouped dashboard grid.
 */
collectionGroups?: CollectionGroupDefinition[]
```

`ResolvedAdminConfig` is `Omit<AdminConfig, 'routes'> & { routes: RoutesConfig }`
(`site-config.ts:216`), so it inherits the property without change.

The existing `CollectionAdminConfig.group` is repurposed. Its documentation
comment is corrected — it refers to a sidebar that has never listed collections
— and restated as a key reference:

```ts
/**
 * Dashboard group this collection belongs to. Must name an entry in
 * `AdminConfig.collectionGroups`. Omit to place the collection in the
 * leading ungrouped band.
 */
group?: string
```

The property is named `collectionGroups` rather than `groups` because
`CollectionAdminConfig.groups` already means form fieldsets
(`GroupDefinition`). The two live one level apart in the same configuration
tree, and reusing the word for unrelated concepts invites confusion.

### Worked example

```ts
// byline/admin.config.ts
import { defineAdminConfig } from '@byline/core'

export const config: AdminConfig = {
  collectionGroups: [
    { name: 'media', label: 'Media' },
    { name: 'authorities', label: 'People & Organisations' },
    { name: 'taxonomy', label: 'Taxonomies' },
  ],
  admin: [pagesAdmin, newsAdmin, imagesAdmin, authorsAdmin, categoriesAdmin],
  // ...
}

defineAdminConfig(config)
```

```ts
// byline/collections/authors/admin.ts
export const authorsAdmin = defineAdmin({
  slug: 'authors',
  group: 'authorities',
})
```

`pages` and `news`, carrying no `group`, render first with no heading. `Media`,
`People & Organisations`, and `Taxonomies` follow in registry order.

## Boot validation

`validateAdminConfigs`
(`packages/core/src/config/validate-admin-configs.ts:105`) gains a third
parameter carrying `collectionGroups`, supplied by `defineAdminConfig`
(`packages/core/src/config/config.ts:78`). Three rules are added, each throwing
in the module's existing fail-fast style:

1. **Duplicate group name.** Two entries in `collectionGroups` sharing a `name`
   throw, naming the duplicate.
2. **Blank name or label.** An empty or whitespace-only `name` or `label`
   throws.
3. **Unresolved group reference.** A `CollectionAdminConfig.group` naming no
   declared group throws, listing the valid names. This single rule covers both
   the typographical-error case and the case where a collection sets `group`
   but the registry was never declared.

An absent or empty `collectionGroups` is legal and means the present flat grid.

## Bucketing

A pure, React-free function in `packages/core/src/config/group-collections.ts`:

```ts
export interface CollectionGroupBucket {
  /** Registry key, or `null` for the leading ungrouped band. */
  name: string | null
  /** Heading text, or `null` when the band renders without a heading. */
  label: string | null
  collections: CollectionDefinition[]
}

export function groupCollectionsForAdmin(
  collections: readonly CollectionDefinition[],
  admin: readonly CollectionAdminConfig[] | undefined,
  collectionGroups: readonly CollectionGroupDefinition[] | undefined
): CollectionGroupBucket[]
```

Rules:

- The ungrouped bucket is emitted first, and is omitted entirely when empty.
- Declared groups follow in registry order.
- A declared group holding no collections is skipped, so no heading ever
  appears above an empty section.
- Within a bucket, the order of `collections` is preserved.
- When `collectionGroups` is absent or empty, the result is a single ungrouped
  bucket containing every collection in declaration order — the present
  behaviour.

The function is placed in `@byline/core` rather than beside the dashboard
component because it is configuration resolution, the same category as
`getCollectionAdminConfig` and `validateAdminConfigs`; because it is React-free
and directly unit-testable under core's node-mode Vitest; and because a second
host adapter rendering a dashboard would otherwise reimplement it.

The function takes no ability information and knows nothing about actors. The
gating described below is applied to its input, not inside it.

## Rendering

The change is confined to `dashboard.tsx`. The card body — currently about 55
lines nested inside a `.map` callback — is extracted into a `CollectionCard`
component, and the map becomes:

```tsx
{buckets.map((bucket) => (
  <section key={bucket.name ?? '__ungrouped__'}>
    {bucket.label !== null && (
      <h2 className={cx('byline-dashboard-group-heading', styles.groupHeading)}>
        {bucket.label}
      </h2>
    )}
    <div className={cx('byline-dashboard-grid', styles.grid)}>
      {bucket.collections.map((collection) => (
        <CollectionCard
          key={collection.path}
          collection={collection}
          stats={statsMap[collection.path]}
        />
      ))}
    </div>
  </section>
))}
```

The grid container moves inside each bucket so cards align within their own
group. The heading follows the file's existing convention of pairing a stable
global class name with a CSS-module class.

## Ability gating

Gating is per collection. There is no group-level ability concept: a group is
not a permission subject, and no ability is ever declared, checked, or
configured for one. A group's visibility is purely a consequence of whether any
of its member collections survived the per-collection filter.

The filter is applied to the collection list **before** `groupCollectionsForAdmin`
runs. A group whose members are all filtered out therefore yields an empty
bucket, which the "skip empty groups" rule already drops. The heading disappears
without any additional logic.

The ability key is built with `collectionAbilityKey(path, 'read')` from
`@byline/core` (exported at `packages/core/src/index.ts:25`) rather than by
string concatenation, so a rename surfaces as a type error.

Two call sites:

- **Route loader** (`create-admin-dashboard-route.tsx`) — filter before
  fetching statistics, so the dashboard stops issuing server-function calls that
  are guaranteed to throw. The `_byline/admin` route's `beforeLoad` already
  places `user.abilities` and `user.is_super_admin` on the router context, which
  the loader reads.
- **Component** (`dashboard.tsx`) — filter `config.collections` through
  `useAbilities().has(...)` before bucketing. Super-administrator bypass is
  inherited from that hook.

### This is a cosmetic affordance

As the file-level documentation of
`packages/host-tanstack-start/src/integrations/abilities.tsx` states, client-side
ability checks are affordances, never security boundaries.
`assertActorCanPerform` remains the enforcement point and is unchanged by this
work. What the gating fixes is the advertisement of inaccessible collections and
the false zero counts described under Background.

### Empty dashboard

An administrator who can read no collection now sees an empty page. The
dashboard gains an empty state — a short message drawn from the `byline-admin`
translation namespace — rather than rendering a bare `<Section>`.

## Out of scope

- **Grouping in the navigation drawer.** `AdminMenuDrawer` lists no collections
  today. Adding collection navigation there is a separate feature, not a
  consequence of this one.
- **Collapsible groups**, persisted collapse state, group icons, and group
  descriptions. `CollectionGroupDefinition` being an object leaves all of these
  additive.
- **Grouping the activity-log collection filter.**
- **Translation of group labels**, per the decision above.
- **Making create-only roles usable.** Not tracked yet — worth filing as an
  issue, since a role holding `create` without `read` is non-functional
  independently of this work.

## Testing

`packages/core/src/config/group-collections.test.node.ts`:

- No registry produces a single ungrouped bucket in declaration order.
- Registry order determines group order, independent of collection order.
- A declared group with no members is skipped.
- The ungrouped band is emitted first and omitted when empty.
- A collection with no admin configuration at all lands in the ungrouped band.
- Collection declaration order is preserved within a bucket.

Additions to `packages/core/src/config/validate-admin-configs.test.node.ts`:

- An unresolved `group` key throws.
- A duplicate group `name` throws.
- A blank `name` or `label` throws.
- A valid registry plus valid references passes.

Manual verification, which the plan must state explicitly rather than imply:

- Ability filtering is bound to React and router context and is not reachable
  from core's node tests. It is verified by signing in as a role restricted to a
  subset of collections and confirming that the other cards, and any group left
  with no members, are absent.
- The grouped dashboard is confirmed in the **server-rendered** HTML, not only
  in the painted page — see Risks.

## Documentation

A new `docs/09-admin-ui/03-collection-groups.md`, linked from
`docs/09-admin-ui/index.md`, following the repository documentation standard
(front matter with matching H1, `Companions:` list, definition before use,
runnable examples). It covers the registry, the key reference, the ungrouped
band, and the read-ability gating, and states plainly that the gating is
cosmetic and that `assertActorCanPerform` is the boundary.

## Risks

**Server-side rendering fallback.** `getAdminConfig()` has a fallback
(`packages/core/src/config/config.ts:120-132`) that synthesises an admin
configuration from the server configuration with `admin: []`, used where the
admin entry has not run. That fallback carries no `collectionGroups`. The
dashboard route sits under `_byline`, whose `beforeLoad` dynamically imports
`byline/admin.config.ts` and registers the client configuration before any child
loader runs, so the dashboard should never take that path. If it ever did, the
page would render flat on the server and regroup on hydration. This is why the
manual check is specified against the server-rendered HTML.

**Stale naming in `CLAUDE.md`.** `CLAUDE.md` refers to `defineClientConfig` and
`ClientConfig`. The exported API is `defineAdminConfig` and `AdminConfig`
(`packages/core/src/config/config.ts:76`). This design uses the names that exist
in the code. Correcting `CLAUDE.md` is out of scope here but worth a follow-up.

## Downstream impact

Both `AdminConfig.collectionGroups` and `CollectionAdminConfig.group` are
optional, and an absent registry preserves the current flat dashboard exactly.
The change is additive and non-breaking; downstream applications adopt it when
they choose to declare a registry.

The ability gating does change behaviour for existing installations: an
administrator who previously saw a card with all-zero counts for a collection
they cannot read will no longer see that card. That is the intended correction,
and it should be called out in the release notes.
