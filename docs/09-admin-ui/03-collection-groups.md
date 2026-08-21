---
title: "Collection groups"
path: "collection-groups"
summary: "How to arrange the admin dashboard's collections into labelled, ordered groups, and how dashboard cards are filtered to the collections an administrator is allowed to read."
---

# Collection groups

Companions:
- [Configuration API](../10-api-reference/01-configuration.md) — the exact `AdminConfig` contract the options on this page belong to.
- [Authentication and authorization](../07-auth-and-security/01-authn-authz.md) — the seven collection abilities, and where they are actually enforced.

A **collection group** is a labelled heading on Byline's admin dashboard with a
set of collections beneath it. Groups are a presentation device and nothing
more: they change how the dashboard is laid out, and they change nothing about
storage, routing, permissions, or the shape of your documents.

Reach for them when one flat grid of cards has stopped being readable. A site
with four or five collections does not need groups. A site that has accumulated
content types, several upload and media libraries, a set of authority
collections for people and organisations, and a handful of small taxonomy
collections does — at that size, the dashboard is a wall of equally weighted
cards, and a reader has to scan every one of them to find anything.

Groups are entirely optional. If you declare none, the dashboard renders the
flat grid it always has.

## Declaring the registry

Groups are declared once, in display order, on `AdminConfig.collectionGroups` in
your `byline/admin.config.ts`:

```ts
import { type AdminConfig, defineAdminConfig } from '@byline/core'

export const config: AdminConfig = {
  i18n,
  routes,
  collections,
  collectionGroups: [
    { name: 'media', label: 'Media' },
    { name: 'authorities', label: 'People & Organisations' },
    { name: 'taxonomy', label: 'Taxonomies' },
  ],
  admin: [pagesAdmin, newsAdmin, imagesAdmin, authorsAdmin, categoriesAdmin],
}

defineAdminConfig(config)
```

Each entry has two properties. `name` is a stable key that collections
reference; readers never see it. `label` is the heading text rendered above the
group.

The array order is the display order. To move `Taxonomies` above `Media` on the
dashboard, move its entry up in this array — you do not touch the collections
themselves, and you do not touch the order of the `collections` array, which
serves a different purpose.

## Joining a collection to a group

A collection joins a group by setting `group` on its admin configuration to a
declared `name`:

```ts
// byline/collections/authors/admin.ts
import { defineAdmin } from '@byline/core'

import { Authors } from './schema.js'

export const authorsAdmin = defineAdmin(Authors, {
  group: 'authorities',
  columns: listViewColumns,
})
```

The value is a key, not a heading. Writing `group: 'People & Organisations'`
here is an error, and Byline rejects it at startup rather than rendering a
second heading with that text.

`group` lives on the admin configuration rather than on the collection schema
because grouping is presentation. `CollectionDefinition` is the server-safe half
of the schema and presentation split — it is consumed by seeds, code generation,
storage flattening, and the markdown assembler, none of which have any use for a
dashboard heading. The practical consequence is that a collection with no admin
configuration at all needs one in order to be grouped, which is two lines:

```ts
export const partnersAdmin = defineAdmin(Partners, { group: 'authorities' })
```

## Collections you have not grouped

A collection that declares no `group` renders in a **leading ungrouped band** —
above the first heading, with no heading of its own. Nothing is hidden as a
result of being ungrouped.

This is what makes gradual adoption workable. You can declare a registry, move
your media and taxonomy collections into groups, and leave your main content
collections alone; they stay at the top of the dashboard where a reader expects
them, rather than being pushed below the new headings or gathered under a
trailing "Other".

## Empty groups render nothing

A declared group with no member collections is skipped entirely. Its heading
does not appear.

This matters in two situations. The first is a group you have declared ahead of
the collections that will populate it — the dashboard simply does not show it
yet. The second is permission filtering, described next.

## Read-ability filtering

A dashboard card appears only when the signed-in administrator holds
`collections.<path>.read` for that collection. Super administrators see every
card.

The filter runs per collection. There is no group-level permission: you never
declare or grant an ability for a group. A group disappears when every one of
its member collections has been filtered out, because the filter runs before the
collections are bucketed and an empty group renders nothing.

The reason the gate is `read` specifically is that everything a card offers
needs it. The card links to the collection's list view, and it displays
per-status document counts; both are refused server-side without `read`. Before
this filtering existed, an administrator without `read` saw the card anyway,
with every status tile showing `0` — indistinguishable from a collection that
was genuinely empty — and following the link then failed.

An administrator who can read no collection at all sees a short message
explaining that they need read access, rather than an empty page.

**This filtering is a cosmetic affordance, not a security boundary.** The
enforcement point is `assertActorCanPerform`, which runs in the service layer on
every read and write path regardless of what the interface chose to draw.
Hiding a card only stops Byline's admin user interface advertising something the
server will refuse. Never treat a hidden card as a reason to relax a permission.

## What Byline rejects at startup

`validateAdminConfigs` checks the registry and every reference to it when
`defineAdminConfig` runs, and throws on:

- two `collectionGroups` entries sharing a `name`;
- an entry with a blank `name` or a blank `label`;
- a `CollectionAdminConfig.group` naming no declared entry — which covers both a
  typographical error and the case where you set `group` but never declared the
  registry.

The last of these is the reason group membership is a key rather than free text.
With plain labels, `group: 'Authorities'` and `group: 'authorities'` would
quietly become two headings; as keys, the second is a startup error naming the
groups you did declare.

## Group labels are not translated

`label` is a plain string, rendered as written, in every admin interface locale.

This is deliberate, and it matches what sits next to it: a collection's own
`labels.singular` and `labels.plural` are rendered untranslated on the dashboard
too. Translating group headings on their own would produce a localised heading
above English card titles. Translated headings belong to a single, uniform pass
over collection labels, which has not happened yet.
