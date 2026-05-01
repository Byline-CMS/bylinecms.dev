# Access Control Recipes

> Companions:
> - [AUTHN-AUTHZ.md](./AUTHN-AUTHZ.md) — the auth subsystem these recipes plug into. The `beforeRead` hook + `QueryPredicate` machinery the recipes use is documented there.
> - [RELATIONSHIPS.md](./RELATIONSHIPS.md) — populate threads `beforeRead` through to populated target collections, so each recipe applies on relation walks too.

This document is a working cookbook of common read-side access-control patterns, written against the `CollectionHooks.beforeRead` hook and the structured `QueryPredicate` it returns. Each recipe states the use case, gives a complete hook implementation, and calls out the edge cases worth knowing about.

## Background

`beforeRead` fires once per `findDocuments` call (and once per
populate batch, per target collection), receives the actor and read
context, and returns a `QueryPredicate`. The predicate is compiled
into the same `EXISTS` / `LEFT JOIN LATERAL` SQL the client's
existing `where` parser already emits, then **AND**ed onto whatever
the caller passed in `where`. Callers never see the scope — it is
invisible, query-level, and applies even when no `where` was
specified. Returning `undefined` from the hook means "no scoping for
this actor" (typically the admin / superuser path).

The predicate language is the same `WhereClause` shape callers
already use, plus `$and` / `$or` for explicit combinators. Field
names resolve through `field-store-map`, so any field type already
filterable via client `where` is filterable from a hook.

---

## Recipe 1 — Owner-only drafts

**Use case.** Anyone with `read` sees published documents. Authors
see their own drafts in addition. Editors with a broader ability see
everything.

```ts
// posts.collection.ts
beforeRead: ({ context }) => {
  if (context.actor?.hasAbility('collections.posts.read.any')) return
  return {
    $or: [
      { status: 'published' },
      { status: 'draft', authorId: context.actor?.id ?? '__none__' },
    ],
  }
}
```

**Notes.** The fallback `'__none__'` collapses cleanly when
`context.actor` is absent — anonymous readers get the published-only
branch. Pair with the existing `status` filter on `FindOptions` for
public sites; the hook still fires and still scopes the draft branch
out.

---

## Recipe 2 — Multi-tenant scoping

**Use case.** Every document belongs to a tenant. Every read clamps
to the actor's tenant — full stop, no ability needed. The
deployment is multi-tenant SaaS.

```ts
beforeRead: ({ context }) => ({
  tenantId: context.actor?.tenantId ?? '__none__',
})
```

**Notes.** This recipe is "deny by default" — anonymous readers see
nothing, because no tenant matches `'__none__'`. If a tenant has a
public storefront, expose it through a separate collection or a
dedicated `published-and-public` flag rather than relaxing this
predicate; tenant scoping is the kind of policy that should never
have a forgotten escape hatch.

---

## Recipe 3 — Embargo / scheduled publish

**Use case.** Editorial workflow needs documents that go live at a
specific timestamp. Non-editors must not see them before then;
editors should see them in preview.

```ts
beforeRead: ({ context }) => {
  if (context.actor?.hasAbility('collections.posts.read.embargoed')) return
  return { publishAt: { $lte: new Date().toISOString() } }
}
```

**Notes.** The predicate compares against `publishAt` at query time,
which means each request reads "now" — caching layers above this
need to be cache-key-aware of time, or the embargo lifts late.

---

## Recipe 4 — Soft-delete hide

**Use case.** Documents are soft-deleted by setting `deletedAt`
rather than removed from the table. Most readers should never see
them; an admin "trash bin" view needs to see them.

```ts
beforeRead: ({ context }) => {
  if (context.actor?.hasAbility('collections.posts.read.deleted')) return
  return { deletedAt: null }
}
```

**Notes.** Pair this with a `delete` collection method that performs
the soft-delete write rather than a hard delete; otherwise the
predicate has nothing to scope. The trash-bin admin view passes the
opt-in ability and sees both states.

---

## Recipe 5 — Department / workspace visibility

**Use case.** Internal CMS where each document is tagged with a
department. Users may belong to multiple departments and see
documents from any of theirs.

```ts
beforeRead: ({ context }) => ({
  departmentId: { $in: context.actor?.departmentIds ?? [] },
})
```

**Notes.** When `departmentIds` is empty, `$in: []` returns no rows
— deny by default. If the actor's department list is loaded
asynchronously (e.g. from a separate roles store), make the hook
async and resolve the list inside it; the read context caches the
predicate per `(collectionPath, actor)` so the lookup runs once per
read regardless of populate fanout.

---

## Recipe 6 — Self-only on user-like collections

**Use case.** A `profiles` collection (or similar user-shaped data)
where ordinary users may only ever see their own row, but staff with
a broader ability see all rows.

```ts
beforeRead: ({ context }) => {
  if (context.actor?.hasAbility('collections.profiles.read.any')) return
  return { id: context.actor?.profileId ?? '__none__' }
}
```

**Notes.** The reserved `id` key resolves to the document version's
logical document id. If your user model links profiles by a separate
foreign key (e.g. `userId` rather than `profileId === actor.id`),
filter on that field instead.

---

## Composition rules

- **Hook predicate AND user `where`.** The compiler merges them with
  implicit AND. A user passing `where: { status: 'draft' }` against
  Recipe 1 sees only their own drafts — both clauses apply.
- **`undefined` means "no scoping".** Use it for the
  superuser / unconditional-read branch. Do not return an empty
  object `{}` for the same purpose; treat empty objects as
  always-true predicates and prefer explicit early-return for
  readability.
- **Deny via sentinel, not by throwing.** When the actor cannot read
  anything in a collection, return a predicate that yields no rows
  (`{ id: '__none__' }`) rather than throwing. Throwing collapses
  list endpoints; sentinel predicates produce the natural empty
  result.
- **Bypass is explicit.** Admin tooling, migrations, and seeds pass
  `_bypassBeforeRead: true` on the read options to skip the hook.
  This is a deliberate escape hatch and should never be used inside
  application code.

## What `beforeRead` is *not* for

- **Field-level redaction.** Use `afterRead` to mutate
  `doc.fields` — that hook already shipped and is the right surface
  for masking, hashing, or omitting individual fields. `beforeRead`
  is row-level only.
- **Computed-field filters.** The predicate compiles against EAV
  store columns and reserved document keys (`status`, `path`, `id`,
  system timestamps). Synthesise a real field if you need to filter
  on something derived.
- **Write-side checks.** `assertActorCanPerform` already gates every
  write path. Don't try to enforce mutation rules from a read hook.
