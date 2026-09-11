---
title: "Upgrading from 5.2 to 6.x"
path: "upgrading-to-v6"
summary: "Upgrade an existing Byline installation to 6.x: repair an incomplete PostgreSQL search schema, and adopt richtext fields whose resolved editor decides what they accept."
---

# Upgrading from 5.2 to 6.x

Companions:
- [Richtext field capabilities](../09-admin-ui/04-richtext-capabilities.md) — the full model behind the richtext change, including the manifest and scan APIs this guide invokes.
- [Indexing and reindexing](../06-search/02-indexing-and-reindexing.md) — how `reindex()` rebuilds a collection, and where provider migrations are applied.
- [Upgrading from 4.19 to 5.x](./06-upgrading-to-v5.md) — the previous step in the upgrade chain, which a 4.x installation must complete first.
- [PostgreSQL and MySQL search providers](../06-search/06-postgres-and-mysql.md) — the driver-owned schema and analyzer metadata this upgrade repairs.

Byline 6 changes two things that need a deliberate response, and they are unrelated to each other. A richtext field's resolved editor now decides which structures the field accepts, not merely which controls it offers. Separately, `@byline/search-postgres` ships a migration that repairs installations whose search schema was left incomplete by an earlier release.

Upgrade every registry-backed `@byline/*` package together — 6.0 is a lockstep major across all of them, and most carry no change of their own beyond the version. Unlike [the v5 upgrade](./06-upgrading-to-v5.md), this release needs no database fence, no maintenance window and no credential rotation: no writer contract changed, and no stored document is rewritten at upgrade time. What it does need is two pre-flight checks, described below, and one post-deploy rebuild if your installation is affected by the search repair.

Install **6.0.1 or later** rather than 6.0.0. `@byline/ui` 6.0.0 published a `development` export condition pointing at TypeScript source inside `node_modules`, which fails a downstream Vitest run with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`; 6.0.1 removes it from the published package.

## Which changes apply to you

| Change | Affects | Before deploying | After deploying |
|---|---|---|---|
| [Search index metadata repair](#search-index-metadata-repair-postgresql) | Installations using `@byline/search-postgres` whose database first booted on 3.15.0 through 4.8.0 | Run the pre-flight query to find out whether you are affected | Rebuild every searchable collection, or search returns nothing |
| [Richtext capabilities](#richtext-capabilities) | Every installation with a `richText` field, and every installation that configures `EditorSettings` | Move each `settings.options` registration, then scan stored content against a capability manifest | Nothing, unless the scan reported content that will open read-only |

---

## Search index metadata repair (PostgreSQL)

`@byline/search-postgres` stores analyzer metadata in `byline_search_index_metadata` and an analyzer fingerprint on each indexed row. Both were added to the driver's `0001_init.sql` in place, in 4.9.0, after that file had already shipped. The migration runner records applied *versions*, not file content, so a database that had already applied `0001` never received them. Any installation whose first boot ran 3.15.0 through 4.8.0 is therefore missing the `analyzer_fingerprint` column, the `NOT NULL` constraint on `search_vector`, and the metadata table itself. Writing to the index fails with:

```text
relation "byline_search_index_metadata" does not exist
```

Migration `0002_analyzer_fingerprint` repairs such a database. Every statement is conditional, so it is idempotent, and it is a no-op on any installation whose `0001` already carried all three changes.

### Check before you upgrade

Run this against the application database:

```sql
SELECT
  (SELECT max(version) FROM byline_search_migrations)            AS at_version,
  to_regclass('public.byline_search_index_metadata') IS NOT NULL AS has_metadata,
  (SELECT count(*) FROM byline_search_documents)                 AS index_rows;
```

`has_metadata = false` means the installation is affected and will need the rebuild below. A database with no `byline_search_migrations` table has never run the PostgreSQL search driver and needs nothing from this section.

:::warning[An affected installation loses its search index]
Rows written before portable lexical analysis carry no analyzer fingerprint and cannot be matched by any current query, so `0002` deletes them rather than inventing one. **On an affected database the search index is emptied, and search returns no results until you rebuild it.** No CMS document is touched: a search index is disposable derived data, rebuilt from published versions.
:::

### Apply the migration

The driver owns an independent numbered migration stream — it is not part of the application's Drizzle migrations. Apply it as an explicit deploy step, before the application serves traffic:

```ts
import { migrate } from '@byline/search-postgres'

const { applied } = await migrate(db.pool, { log: (m) => logger.info(m) })
// applied: [2]  (empty when already up to date)
```

**Edit:** `apps/webapp/byline/server.config.ts`, which already calls `migrate()` on the adapter's existing pool. The three supported ways to apply the stream — by hand for managed PostgreSQL, a deliberate `migrate()` call, or `autoMigrate` in development — are described in [Provider migrations](../06-search/02-indexing-and-reindexing.md#provider-migrations).

The migration is independent of provider selection. A host that calls `migrate()` from `@byline/search-postgres` applies `0002` whichever provider is registered on `ServerConfig.search`, but only the PostgreSQL index is touched — an installation that has since moved to a different provider needs no rebuild.

### Rebuild the index

Immediately after deploying, rebuild every searchable collection. Until each one completes, queries against that collection return nothing:

```ts
import { getSystemBylineClient } from '@byline/client/server'

const report = await getSystemBylineClient().collection('docs').reindex()

console.log(report)
// { collectionPath: 'docs', documents: 240, indexed: 240 }
```

An operator with the `collections.<path>.reindex` ability can do the same from the collection's list view where the admin config registers `ReindexButton`. Reindexing is synchronous and pages through 100 published documents at a time, which suits small and medium collections; see [Rebuild a collection](../06-search/02-indexing-and-reindexing.md#rebuild-a-collection) for the full contract.

---

## Richtext capabilities

In 5.x, narrowing a richtext field hid controls. The field still accepted every structure the editor could register, so a heading arrived in a title field by paste, by Markdown shortcut, or from storage regardless of the toolbar. In 6.0 removing an extension removes its node registration as well as its controls, so a field configured without headings no longer accepts one by any route.

Two separate pieces of work follow from that, and they need different responses: a mechanical configuration rename, and a check against real content.

### The configuration API changed

`EditorSettings.options` is replaced, with no alias, by `mode`, `markdownShortcuts`, `controls` and `debug`. Every registration must move:

| 5.x | 6.0 |
|---|---|
| `options.richText` | `mode: 'richText' \| 'plainText'` |
| `options.markdownShortcutPlugin` | `markdownShortcuts` |
| `options.showTreeView` | `controls.treeView` |
| `options.textStyle` | `controls.blockFormat` |
| `options.inlineCode` | `controls.inlineCode` |
| `options.undoRedo` | `controls.undoRedo` |
| `options.textAlignment` | `controls.textAlignment` |
| `options.markdownToggle` | `controls.markdownToggle` |
| `options.debug` | `debug` |

A 5.x preset:

```ts
// 5.x
function applyMinimalPreset(config: EditorConfig): EditorConfig {
  const o = config.settings.options
  o.textAlignment = false
  o.textStyle = false // hides the block-format dropdown (headings / lists / quote)
  o.inlineCode = false
  o.undoRedo = false
  o.markdownToggle = false
  o.markdownShortcutPlugin = false
  return config
}
```

becomes:

```ts
// 6.0 — apps/webapp/byline/fields/richtext/lexical-richtext-minimal.ts
function applyMinimalPreset(config: EditorConfig): EditorConfig {
  const c = config.settings.controls
  c.textAlignment = false
  c.blockFormat = false // hides the dropdown; does NOT disable headings
  c.inlineCode = false
  c.undoRedo = false
  c.markdownToggle = false
  config.settings.markdownShortcuts = false
  return config
}
```

`Nodes` is renamed `READABLE_NODES` and is no longer a registration list. It is the vocabulary of node classes Byline can read, used by the normalizer and the capability manifest; a field's registered nodes now come from its resolved extensions.

The rename is not the substance of the upgrade. Read each call site and decide which of three things it meant. Where a registration used `textStyle: false` to mean "this field should hold no headings", that intent belongs in the extensions list, because the flag only ever hid the dropdown:

```tsx
// apps/webapp/byline/fields/richtext/lexical-richtext-minimal-admin.tsx
import { builtInExtensions, lexicalEditor } from '@byline/richtext-lexical/config'

export function configureMinimalEditor<T extends { extensions?: any }>(c: T): T {
  c.extensions
    .remove(builtInExtensions.Heading)
    .remove(builtInExtensions.Quote)
    .remove(builtInExtensions.List)
    .remove(builtInExtensions.CheckList)
  return c
}

export const LexicalRichTextMinimal = lexicalEditor(configureMinimalEditor)
```

Extension references are not JSON-safe and would break tsx-loaded seeds, so removal lives on the admin side and reaches a single field through `FieldAdminConfig.editor`. Settings stay on the schema side. [Richtext field capabilities](../09-admin-ui/04-richtext-capabilities.md) covers the two-sided model and which extension owns which node.

Bold, italic and inline code are the exception: they are `TextNode` formats rather than node types, so they have no node to unregister and cannot be constrained by either half.

### What a field accepts changed

This is the part to check against real content. A field narrowed in 5.x — where narrowing only hid controls — may hold content it no longer accepts.

Nothing on disk changes when you upgrade. A document written under a wider configuration is adapted when an editor opens it: a heading becomes a paragraph, the text preserved, and the reader is told. Content with no safe conversion, such as an inline image or an embed, is never restructured; that field opens read-only instead, names the content, and discards nothing. **Stored values change only when that field is edited and saved.** Reads through `@byline/client`, Markdown export and every other consumer are unaffected either way.

The risk is therefore not data loss. It is an editor meeting an adapted or read-only field without warning.

### Scan before you deploy

The check runs in two steps, because capabilities and content are established differently: measuring what a field accepts means building its editor, which needs a DOM, while scanning stored values needs a database connection. A manifest file travels between them.

In this repository, the two steps are:

```sh
cd apps/webapp
pnpm byline:richtext-manifest
pnpm tsx byline/scripts/richtext-scan.ts
```

:::warning[The headless harness does not yet run against published packages]
Both commands are reference-application tooling, and they work here because `@byline/*` resolve through workspace links, so Vite processes the whole module graph. In an application that installs `@byline/*` from npm, Vitest externalises those packages, Node performs the import instead, and the run fails on the CSS that `@byline/ui`'s `dist` imports (`ERR_UNKNOWN_FILE_EXTENSION`). `byline/scripts/richtext-scan.ts` is reference-application source as well — `byline init` does not install it.

Until [issue #96](https://github.com/Byline-CMS/bylinecms.dev/issues/96) is resolved, a downstream installation has to assemble the pre-flight itself, in two halves.

For the manifest, the interactive page at `/admin/richtext-capabilities` produces the same file in a browser, where none of the externalisation problem applies — but it is reference-application source too, so **you must copy it into your application before you can open it**. Four files carry it, and every package they import is published:

```text
src/routes/_byline/admin/richtext-capabilities.tsx
src/routes/_byline/admin/richtext-capabilities.css
src/lib/richtext-capability-probe.tsx
src/lib/richtext-capability-targets.ts
```

The page is served only in development, so it needs a running application and a browser session.

For the scan, drive the published APIs directly — they are shipped exports and carry none of this problem: `buildManifest` and `capabilitiesFor` from `@byline/richtext-lexical`, and `scanDocument` and `summarise` from the runtime-free `@byline/richtext-lexical/scan` subpath. [Using the APIs directly](../09-admin-ui/04-richtext-capabilities.md#using-the-apis-directly) shows both halves.
:::

The first command mounts every richtext field's editor in jsdom, records the node types each registered, and writes `byline/generated/richtext-capabilities.json`. It reaches only the admin configuration graph — no database, no server configuration — so it is genuinely read-only and needs no browser and no running application. Run it with the v6 packages installed: it measures what the resolved editor accepts, and a 5.x editor registers a different set of nodes.

The second reads every value in `byline_store_json` — every document, every version including archived ones, every locale — matches each against the manifest, and reports per collection:

```text
Will adapt on open:     6
Will open read-only:    44
Capabilities unknown:   0
```

:::warning[The scan is not read-only against the database]
`byline/scripts/richtext-scan.ts` imports `byline/server.config.ts` to resolve the collection registry and a database connection, and that module applies pending search and analytics migrations as a deliberate startup step. Running the scan therefore applies the search migration described above. On a database the [pre-flight query](#check-before-you-upgrade) reported as affected, **the scan empties the search index**, before you have deployed anything.

Run the scan against a staging copy, or run the pre-flight query first and treat whichever step applies `0002` as the point from which search is down until you rebuild.
:::

The scan exits non-zero if any value would open read-only, **or** if any field's capabilities could not be measured, so it can gate a deployment. Exit zero is not the same as no findings: content that will be *adapted* is reported and does not fail the run, because adaptation preserves the text and needs no intervention. Read the adaptation count rather than only the exit status — it tells you how much content editors will see change under them, which may still be worth announcing.

If the scan reports content that will open read-only, restore the extension that owns it for that field, or migrate the content, before deploying. [Checking existing content](../09-admin-ui/04-richtext-capabilities.md#checking-existing-content) documents the report format, the interactive equivalent at `/admin/richtext-capabilities`, and the `@byline/richtext-lexical/scan` API for hosts that need their own workflow.

---

## Rollout

1. Run the search pre-flight query and record whether the installation is affected.
2. In the upgrade checkout, raise every `@byline/*` package together to 6.0.1 or later and install. The capability manifest measures the editor the installed packages resolve, so it cannot be generated before this step.
3. Move every `settings.options` registration to `mode` / `markdownShortcuts` / `controls` / `debug`, deciding per call site whether the intent was to hide a control, remove a capability, or both. Typecheck: the removed API has no alias, so the compiler finds the call sites for you.
4. Generate the capability manifest and scan stored content, observing the warning above about what the scan applies. Resolve anything reported read-only, and note the adaptation count.
5. Deploy. The search migration applies as its explicit startup step, before the application serves traffic.
6. If the pre-flight query reported `has_metadata = false`, rebuild every searchable collection and confirm that search returns results. Do this whether the migration first applied at scan time or at deploy time.

## Rollback

No document content is rewritten by the upgrade itself, and adapted content is written only when an editor saves a field. That adaptation narrows structure — a heading becomes a paragraph — which a 5.x editor still reads, so returning to 5.2 packages does not strand content.

The search repair is one-way. `0002` deletes rows that carry no analyzer fingerprint, and those rows are not recoverable by reverting the application; a 5.x installation reading that index needs the same rebuild. Plan the rollback to include a reindex rather than assuming the index survives it.

## Verification boundary

Repository tests verify the migration, the resolved-editor node registration, content adaptation on load, the read-only refusal path, and that the capability manifest agrees with the runtime it predicts. They cannot verify that a downstream operator ran the pre-flight query against the right database, found every copied preset in every application repository and deployment image, or completed a rebuild for each searchable collection. Record those operator actions separately for the installation being upgraded.
