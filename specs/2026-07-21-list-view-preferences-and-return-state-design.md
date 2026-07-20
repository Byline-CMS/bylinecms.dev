# List-view preferences and return-to-list state — design

Date: 2026-07-21
Issues: [#16 Persisted list-view preferences](https://github.com/Byline-CMS/bylinecms.dev/issues/16), [#17 Return-to-list state after editing and closing a document](https://github.com/Byline-CMS/bylinecms.dev/issues/17)
Status: approved in brainstorming with Tony, 2026-07-21

## Purpose

Two related admin-UI mechanisms, designed together because they compose on the same
precedence rule (explicit URL params always win) but are deliberately independent:

1. **Per-user persisted list-view preferences (#16)** — a user's `page_size` and
   default column sort survive across sessions and devices, and seed a
   params-less landing on a collection list. DB-backed (SSR-safe, no flicker).
2. **Return-to-list state (#17)** — opening a document from page 7 of a filtered
   list, saving, and closing lands the user back on page 7 of that same list.
   Pure navigation state; no storage involved.

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Preference storage | New scoped key-value table `byline_admin_user_preferences` (not a jsonb blob on `byline_admin_users`, not per-feature columns) |
| Sticky keys | `page_size`, `order`, `desc` only. `page`, `query`, `status`, `locale` are per-visit |
| Return-to mechanism | `from` search param on the editor route carrying the list's URL-encoded search state (not router history state, not `history.back()`) |
| Write trigger | Implicit — changing page size or column sort quietly upserts the preference; no new UI |
| Where preferences apply | Server-side, inside the `getCollectionDocuments` server fn, in the same place `defaultSort` already applies (approach A; no `beforeLoad` redirect, no client rehydration) |
| Surfaces | Collection list route only in this PR. Scope keys are generic strings so the admin-users list and future surfaces follow later with no schema change |
| Module placement | New `admin-preferences` module in `@byline/admin` beside `admin-account`; Postgres repository in `@byline/db-postgres/admin`; thin server fns in `@byline/host-tanstack-start` |

## Section 1 — data model and migration

New table `byline_admin_user_preferences` in
`packages/db-postgres/src/database/schema/auth.ts`, beside `byline_admin_users`:

| Column | Type | Notes |
|---|---|---|
| `user_id` | `uuid` NOT NULL | FK → `byline_admin_users.id`, `ON DELETE CASCADE` |
| `scope` | `varchar(255)` NOT NULL | e.g. `collections.docs.list` |
| `value` | `jsonb` NOT NULL | scope-shaped payload, Zod-validated at write |
| `created_at` / `updated_at` | | existing `timestamps` helper |

- Primary key: composite `(user_id, scope)` — natural key; writes are a single
  `INSERT … ON CONFLICT (user_id, scope) DO UPDATE`; no separate unique index.
- Deleting a user cascades to their preferences.
- The `scope` string is the generality lever. This PR writes only
  `collections.<collectionPath>.list`. Other surfaces claim their own scopes later
  with zero schema change.
- List-scope `value` shape: `{ page_size?: number, order?: string, desc?: boolean }`
  — all keys optional, so a user who has only changed page size does not get a
  frozen sort as a side effect.

Migrations, both streams:

1. Drizzle schema addition + `pnpm drizzle:generate` for development.
2. Hand-written `packages/db-postgres/sql/0005_add-admin-user-preferences.sql`
   following the style of `0001`–`0004`, for existing sites.

## Section 2 — server-side flow

New module `packages/admin/src/modules/admin-preferences/` shaped like its
siblings (`commands.ts`, `repository.ts`, `service.ts`, `schemas.ts`, `errors.ts`
if needed):

- `AdminPreferencesRepository` interface: `get(userId, scope)`,
  `upsert(userId, scope, value)`. Postgres implementation in
  `@byline/db-postgres/admin`, plugged into the `AdminStore` aggregate.
- Commands: `getPreferenceCommand(context, { scope })` and
  `setPreferenceCommand(context, { scope, value })`. **Self-service only** — they
  always operate on the authenticated actor's own `userId` from the
  `RequestContext` (the `setPreferredLocaleCommand` pattern). No new abilities;
  an authenticated admin session is the whole requirement. There is no path to
  read or write another user's preferences.
- `schemas.ts` validates the list-scope payload: `page_size` integer 1–100
  (matching the route search schema cap), `order` non-empty string, `desc`
  boolean, all optional.

**Write path**: thin server fn `setListViewPreference` in
`packages/host-tanstack-start/src/server-fns/collections/` taking
`{ collection, page_size?, order?, desc? }`. Resolves context via
`getAdminRequestContext()`, builds the scope key, delegates to
`setPreferenceCommand`. The client sends only the keys it just changed (the
explicit state produced by the interaction — a page-size change sends
`page_size`; a header-sort click sends `order` + `desc`), and the upsert
**merges those keys into the stored value** (`SET value =
byline_admin_user_preferences.value || excluded.value`), so a page-size change
never wipes or freezes a previously saved sort. No key-deletion path is needed
for this slice.

**Read path**: inside `getCollectionDocuments` (where `defaultSort` already
applies), after the request context is resolved. Precedence per key:

- `page_size`: explicit URL param → preference → route default
- `order` / `desc`: explicit `order` param → preference (only if its `order`
  still names a sortable field on the collection — stale preferences are
  skipped, not errors) → `defaultSort` → `created_at desc`

Effective values echo through `meta` (as `defaultSort` already does) so the
header sort indicator and page-size control render correctly on a params-less
SSR landing — no flicker. One extra single-row indexed read per list load, in
the same round trip. A preference-read failure logs and falls through to
defaults; it can never break the list.

Deliberate exclusion: `orderable: true` and `tree: true` collections skip sort
preferences entirely, consistent with `defaultSort` being rejected on orderable
collections.

## Section 3 — client side

**Preference writes** (in
`packages/host-tanstack-start/src/admin-shell/collections/list.tsx`): the two
existing handlers that navigate on page-size change and column-header sort get
one extra fire-and-forget call to `setListViewPreference` with the keys that
interaction changed (see Section 2's merge semantics). Failures `console.warn`
and nothing else — a background preference save
must never toast, block, or disturb the navigation that just happened. No new
UI chrome.

**Return-to-list (`from` param)**:

- **Serialization**: the list's current search subset (`page`, `page_size`,
  `order`, `desc`, `query`, `locale`, `status`) is `URLSearchParams`-encoded into
  one string. Helper pair `encodeListReturnState` / `decodeListReturnState`
  beside the routes; decode runs the result back through the list search schema
  (`safeParse`); malformed input degrades to the bare list, never an error.
- **Carrying it**: the edit links in `list.tsx` add `search: { from }`. The
  editor route's search schema gains `from: z.string().optional()`. Save already
  spreads `prev` search on its re-navigation, so `from` survives repeated saves.
- **Fixing the droppers**: three editor navigations currently replace the whole
  search record — locale switch (`edit.tsx` ~line 77), copy-to-locale (~line
  274), delete-locale (~line 326). Each changes to spread `prev` plus its own
  key, so switching locale mid-edit no longer discards the return target.
  (Pre-existing wart this feature forces us to fix.)
- **Consuming it**: `onCancel` and post-delete decode `from` and navigate to the
  list with that state restored; absent/invalid `from` behaves exactly as today.
  Duplicate threads `from` forward to the new document's editor.
- **Precedence composes**: a restored `from` state is just explicit URL params,
  which always beat stored preferences — no special cases.

The create flow (list → create → back) gets the same treatment on its cancel
path if trivial during implementation; otherwise a noted follow-up (#17 is
framed around edit/close).

## Section 4 — error handling and testing

Error handling:

- Preference read failure in the list server fn: log, fall through to defaults.
- Preference write failure: `console.warn` only.
- Stale preference (`order` no longer sortable on the collection): skipped
  silently at apply time; not deleted (the schema may come back).
- `page_size` out of range: Zod rejects at write; clamped defensively at read.
- Malformed or absent `from`: bare list, as today.
- Unauthenticated `setListViewPreference`: rejected by
  `getAdminRequestContext()`; in practice unreachable (list UI renders only
  inside an authenticated shell).

Testing:

- **Unit (node, no Postgres)**: `admin-preferences` Zod schemas (accept/reject
  boundaries, 1–100 clamp); `encodeListReturnState` / `decodeListReturnState`
  round-trip + malformed-input degradation as `*.test.node.ts` beside the
  helpers (the `resolve-preview-url.test.node.ts` pattern); the read-side
  precedence chain (URL → preference → `defaultSort` → `created_at desc`,
  including the stale-order skip) extracted into a pure function so it is
  unit-testable without a database.
- **Integration (Postgres)**: repository coverage in the style of the existing
  admin-store repository tests — upsert then get, conflict-update on the
  composite key (including per-key merge: writing `{ page_size }` preserves a
  previously stored `order`/`desc`), cascade delete with the user row.
- **Browser verification** (before the PR): set page size on a collection list →
  fresh params-less landing shows the preferred size and sort, no flicker; open
  a document from page 2 of a filtered list → save → close → back on page 2 with
  filters intact; switch editor locale mid-edit → close → return target intact.

## Delivery

Single branch and PR covering both issues (they share the precedence design and
touch the same files), referencing #16 and #17. Conventional commits per the
repo's commit skill. Migration lands in both streams (Drizzle + numbered SQL
script). Manual browser verification via the dev server before the PR is opened.
