# Configuration Surface Breaking Cleanup Plan

Date: 2026-08-02
Status: implementation complete; four draft pull requests published
Last revised: 2026-08-02 after implementation and coordinated four-repository verification

## Goal

Remove the unsafe, unused collection-serialization contract; retire compatibility
surface that no longer has a design purpose; and rename Byline's configuration
APIs so that server runtime configuration, admin UI configuration, public host
data, and future remote transport configuration have unambiguous ownership.

The work may span multiple sessions and repositories. Check off tasks only after
their stated verification gate passes, and record any changed decision in this
file before continuing.

## Repositories in scope

Primary framework repository:

- `/Users/tony/Clients/Infonomic/Projects/Byline/Solutions/bylinecms.dev`

Owned downstream production applications:

- `/Users/tony/Clients/Infonomic/Projects/Byline/Solutions/bylinecms.app`
- `/Users/tony/Clients/OSU/Solutions/modulus-learning.org`
- `/Users/tony/Clients/FORRU/01-Website/Solutions/beta.forru.org`

The downstream applications are owned and can accept coordinated breaking
changes. This removes the need for deprecated aliases, compatibility shims, or a
long migration window, but every downstream application and the CLI templates
must still be migrated and verified.

## Findings that motivate the work

1. `toSerializableCollection()` is documented as safe for `Response.json(...)`,
   but it uses a denylist. It retains later-added function and implementation
   properties, including `CollectionDefinition.buildDocumentPath` and
   `Field.upload.storage` / `Field.upload.hooks`. An S3 storage-provider instance
   carries enumerable provider and client state.
2. No in-scope repository uses `toSerializableCollection`,
   `SerializableCollectionDefinition`, `SerializableField`, or
   `SerializableBlock`. Deletion is safe across the known production estate and
   CLI templates.
3. The correct HTTP/MCP collection descriptor cannot be known until a real
   transport consumer defines it. Repairing the unused serializer now would
   prematurely create another guessed wire contract.
4. `ClientConfig` is actually admin React/presentation configuration. Its name is
   likely to conflict with future configuration for `@byline/client` or a remote
   HTTP SDK.
5. `i18n.interface` and `interfaceLocales` mean the Byline admin interface, while
   every host application also owns a separate public-frontend interface locale
   set. The current terminology obscures that distinction.
6. `serverURL` is required on server and client configs, but the only Byline
   runtime consumer is the admin sign-in page's Home link. The host application
   already owns its canonical origin through `getPublicConfig().serverUrl`, which
   supplies absolute sitemap, canonical, hreflang, social-image, markdown, and
   `llms.txt` URLs. The sign-in page's SSR path is a plumbing constraint, not a
   reason for Byline to duplicate that required value: the host route can pass an
   optional `homeUrl` from its client-safe public config into the sign-in route
   factory and page.
7. `public.ts` must remain a synchronous, dependency-light module. Host locale
   rewriting, TypeScript literal inference, CLI route generation, and client
   hydration all need a static snapshot. An HTTP API may supplement this boundary
   later but cannot replace it for the integrated host.
8. The CLI has two precise source contracts for reserved route segments. In
   `byline/locales.ts`, it evaluates the exported `contentLocales` array and each
   entry's static string `code`. In `src/i18n/i18n-config.ts`, it evaluates the
   exported `i18nConfig` object and its static `locales` and `defaultLocale`
   properties. It does not statically read `interfaceLocales`, locale labels, or
   other locale-definition properties. Do not wrap or rename either pinned shape
   without deliberately updating the parser and its tests.
9. Developer Markdown under `docs/` is imported into the live Byline docs
   collection. A document's frontmatter `path` is therefore a published URL, not
   merely a repository label. The importer finds existing content by the new
   path; changing the path can create a second document rather than moving the
   existing one, and the docs route has no stored redirect table. Documentation
   slug changes require an explicit content-migration and redirect decision.

## Decisions

- Delete the unsafe serializer and its types. Do not deprecate or replace them in
  this work.
- Build no installation manifest or collection descriptor yet. When HTTP or MCP
  supplies a real consumer, create an explicit allowlisted descriptor from first
  principles.
- Keep `byline/locales.ts`, `byline/routes.ts`, and `byline/public.ts` as static
  authored modules. Do not add a public-config singleton or registration step.
- Rename client configuration to admin configuration across the framework, CLI,
  docs, and applications.
- Rename the admin i18n axis explicitly; do not couple the host frontend's route
  default automatically to Byline's default content locale.
- Remove `serverURL` from Byline configuration entirely. The host owns its public
  origin; it may pass optional `homeUrl` to the sign-in route factory when it
  wants the Home link. A future remote SDK will use a separate
  `baseURL`/`apiURL` contract.
- Preserve the published `client-config-registration` docs path by default when
  renaming the document and source file for `AdminConfig`. Change that path only
  with an explicit CMS document-path migration and durable redirect plan.
- Remove carried compatibility aliases in the same breaking release, but keep
  their implementation phase independently verifiable.

## Delivery slices

Keep the work bisectable even if several slices land in one breaking release:

1. Delete the serializer, narrow the public facades, and correct the MCP design
   document.
2. Remove the independently verifiable deprecated compatibility APIs after
   migrating the thirteen downstream `picker` declarations.
3. Rename `ClientConfig` to `AdminConfig`, remove `serverURL`, and add the narrow
   optional sign-in `homeUrl` route input, including the documentation source
   rename while preserving its published path.
4. Rename the admin i18n terminology in its own pull request and preferably its
   own release. This slice crosses core, i18n, admin preferences, host server
   functions, persisted preferred-locale semantics, CLI templates, applications,
   and the internationalization documentation.

Do not combine slices 3 and 4 into a single mechanical rename commit.

If any downstream application cannot pass its migration gates in the release
window, do not promote the breaking package set for that application. Keep it
pinned to the previous coherent Byline versions and redeploy that known-good
build if necessary. Hold or revert the coordinated downstream branch rather than
adding temporary compatibility aliases to partially land the new API.

## Non-goals

- Designing the stable HTTP operation contract.
- Designing the future MCP collection descriptor.
- Adding `/.well-known/byline`, `/api/config`, OpenAPI, or a remote SDK.
- Replacing `public.ts` with a runtime getter or network fetch.
- Changing collection schema behavior, persisted data, database migrations, or
  generated collection data shapes.
- Automatically making the host frontend default locale equal the Byline content
  default. A host may choose and test that invariant separately.

---

## Phase 0: Preflight and coordination

- [x] Confirm all four repositories are on known clean branches and record their
  branch names in the implementation session notes.
- [x] Read each repository's current `AGENTS.md` before editing it. In particular,
  `beta.forru.org/AGENTS.md` requires checking `TODO-INTERNAL.md` before
  re-deriving deferred design decisions.
- [x] Repeat the serializer gate across all repositories:

  ```bash
  rg -n "toSerializableCollection|SerializableCollectionDefinition|SerializableField|SerializableBlock" \
    /Users/tony/Clients/Infonomic/Projects/Byline/Solutions/bylinecms.dev \
    /Users/tony/Clients/Infonomic/Projects/Byline/Solutions/bylinecms.app \
    /Users/tony/Clients/OSU/Solutions/modulus-learning.org \
    /Users/tony/Clients/FORRU/01-Website/Solutions/beta.forru.org
  ```

  Expected before Phase 1: definitions in `bylinecms.dev` only; no callers.
- [x] Decide the cross-repository delivery mechanism before Phase 3: local
  workspace/package override, prerelease package versions, or ordered package
  release followed by downstream dependency updates.
- [x] Keep the phases below as separate commits or changesets even if they share a
  branch. Each phase must be independently understandable and verifiable.

---

## Phase 1: Delete the unsafe speculative wire contract

### Framework changes

Primary file:

- `packages/core/src/@types/collection-types.ts`

Tasks:

- [x] Delete `SerializableField`.
- [x] Delete `SerializableBlock`.
- [x] Delete `SerializableCollectionDefinition`.
- [x] Delete `toSerializableCollection()` and its API/SSR examples.
- [x] Remove imports used only by these types or the helper.
- [x] Search package barrels and published export tests for explicit references;
  remove them if present. The current root type barrel is expected to re-export
  them only transitively.
- [x] Correct the comment on `BaseConfig` in
  `packages/core/src/@types/site-config.ts`: it contains shared live/isomorphic
  runtime values and must not claim to be a wire-serializable contract.
- [x] Add a changeset that clearly identifies the deleted public symbols as a
  breaking change.

### Planned-transport documentation correction

File:

- `docs/05-reading-and-delivery/05-mcp-server.md`

Tasks:

- [x] Change `describe_collection` so it does not depend on
  `CollectionDefinition + admin config`.
- [x] State that it will consume a future allowlisted `CollectionDescriptor`
  derived from the server's collection registry and the authenticated actor's
  capabilities.
- [x] State that `CollectionAdminConfig` is unavailable in the preferred MCP
  server deployment and is not a serializable transport contract.
- [x] Do not define the descriptor's full field list in this phase.

### Narrow the static public facades

Target public runtime exports in the reference app and all three downstream
applications:

```ts
export { contentLocales } from './locales.js'
export { routes } from './routes.js'
```

Tasks:

- [x] Remove `interfaceLocales` and `LocaleDefinition` from every application's
  `public.ts`; the downstream audit found no public-host imports of either.
- [x] Keep interface/admin locale data available through direct `locales.ts`
  imports inside `byline/i18n.ts`.
- [x] Do not export a speculative config object or manifest.
- [ ] Export a content default through `public.ts` only when a concrete public
  host consumer needs it. The host's current `i18nConfig.defaultLocale` remains
  an independent CLI source contract.
- [x] Keep and update source-graph/bundle guards that ensure `public.ts` does not
  reach admin translations, React presentation, or server implementations.

### Add a dead-public-export audit

The current root `knip.json` treats `src/*.{ts,tsx}` library barrels as entry
files, leaves `includeEntryExports` disabled, and explicitly turns the `exports`
and `types` rules off. The ordinary `pnpm knip` gate therefore cannot identify
an unused exported helper such as `toSerializableCollection()`.

Tasks:

- [x] Add a dedicated `pnpm knip:exports` library-public-export configuration or
  command that enables `includeEntryExports` and the `exports` and `types` rules
  for published library packages. Do not assume the flag alone overrides rules
  that are `off`.
- [x] Run it once as a baseline and classify every finding. An export may be a
  deliberate external API even when the monorepo has no internal consumer.
- [ ] Record intentional public exports explicitly using the narrowest supported
  Knip ignore/tag mechanism or a reviewed allowlist; do not globally suppress
  the rule again.
- [ ] Add the resulting audit to CI as a warning first. Promote it to an error
  only after the baseline is clean and stable enough that new findings are
  actionable.
- [x] Document that this audit finds candidates for public-API review; it cannot
  prove an export is unused by consumers outside the audited repositories.

The initial published-package baseline contains 527 runtime exports and 535
exported types. Most are intentional external API, so the command is deliberately
non-blocking and bounded to 100 displayed findings per category. Do not add this
raw report to CI until the intentional public surface has a reviewed baseline;
otherwise the volume would hide new findings rather than prevent them.

### Phase 1 verification

- [x] `rg` finds none of the four deleted symbol names outside this historical
  specification in any in-scope repository.
- [x] `pnpm --filter @byline/core test`
- [x] `pnpm --filter @byline/core typecheck`
- [x] The new dead-public-export audit either passes its reviewed baseline or has
  an explicitly documented follow-up before it becomes a blocking CI gate.
- [x] `pnpm docs:check`
- [x] `git diff --check`

The serializer deletion requires no downstream edits. Narrowing `public.ts`
requires the same small facade edit in the reference app, all three downstream
applications, and both CLI template variants.

---

## Phase 2: Remove obsolete compatibility surfaces

### 2A. Migrate `picker` to `itemView` in downstream applications

The downstream audit found thirteen active `picker:` declarations.

`bylinecms.app`:

- `apps/webapp/byline/collections/media/admin.tsx`
- `apps/webapp/byline/collections/news-categories/admin.tsx`

`modulus-learning.org`:

- `apps/webapp/byline/collections/media/admin.tsx`
- `apps/webapp/byline/collections/topics/admin.tsx`
- `apps/webapp/byline/collections/news-categories/admin.tsx`

`beta.forru.org`:

- `apps/webapp/byline/collections/content-types/bios/admin.tsx`
- `apps/webapp/byline/collections/content-types/bios-categories/admin.tsx`
- `apps/webapp/byline/collections/uploads/media/admin.tsx`
- `apps/webapp/byline/collections/content-types/news-categories/admin.tsx`
- `apps/webapp/byline/collections/misc/languages/admin.tsx`
- `apps/webapp/byline/collections/facets/topics/admin.tsx`
- `apps/webapp/byline/collections/facets/formats/admin.tsx`
- `apps/webapp/byline/collections/facets/geographic-focus/admin.tsx`

Tasks:

- [x] Change every active `picker:` property to `itemView:`.
- [x] Rename local `pickerViewColumns` identifiers only where doing so improves
  clarity; the identifier name is not part of the framework contract.
- [x] Update application comments that still instruct authors to use `picker:`.
- [x] Verify each application before removing the framework alias.

### 2B. Remove the framework alias

Framework files include:

- `packages/core/src/@types/admin-types.ts`
- `packages/core/src/config/config.ts`
- `packages/core/src/index.ts`
- `packages/client/src/search.ts`
- `packages/admin/src/fields/relation/relation-summary.tsx`
- `packages/admin/src/fields/relation/relation-picker.tsx`
- related tests and collection documentation

Tasks:

- [x] Remove `CollectionAdminConfig.picker`.
- [x] Remove the fallback to `config.picker`.
- [x] Decide whether `resolveItemViewColumns()` still adds a useful semantic
  boundary. If it only returns `config?.itemView`, delete it and read `itemView`
  directly at its callers.
- [x] Delete compatibility-only tests and add/retain canonical `itemView` tests.
- [x] Remove deprecated `picker` API documentation while retaining ordinary prose
  uses of “picker” that refer to the UI control.

### 2C. Remove other unused deprecated runtime APIs

Tasks:

- [x] Remove `UnionRowValue` from
  `packages/core/src/@types/store-types.ts`; use `UnifiedFieldValue` exclusively.
- [x] Remove `ReadContext.beforeReadCache`, its compatibility accessor in
  `packages/core/src/auth/read-context-scope.ts`, and tests/documentation that
  exist only to prove caller-supplied cache values are ignored. Preserve the
  private authority-bound before-read cache implementation.
- [x] Remove `configureSignInRoutePath()` and
  `createSignInRoutePathResolver()` from
  `packages/host-tanstack-start/src/routes/sign-in-path.ts`.
- [x] Remove the deprecated `signInPath` option from
  `createAdminLayoutRoute()`; use registered `routes.signIn` directly.
- [x] Remove the deprecated `SignInForm.callbackUrl` component prop and simplify
  `resolveSignInFormRedirect` accordingly.
- [x] Keep the sign-in route's `callbackUrl` URL search parameter unless a
  separate route-contract change explicitly renames it. The deprecated React
  prop and the current URL parameter are different contracts.
- [x] Remove compatibility exports, tests, and docs for the deleted APIs.

### Phase 2 verification

- [x] No active `picker:` configuration remains in any downstream application.
- [x] No deleted compatibility symbol remains in framework or application source.
- [x] Run focused core, client, admin, and host package tests.
- [x] Run `pnpm typecheck` and `pnpm test` in `bylinecms.dev`.
- [x] Run `pnpm typecheck` and `pnpm build` in all three downstream applications
  against the breaking framework build/package.

---

## Phase 3: Rename configuration APIs and correct ownership

Each subphase is intentionally coordinated across the framework, CLI templates,
documentation, and all downstream applications. Do not ship half of any one
rename, but keep Phase 3B separate from Phases 3A and 3C for review, bisection,
and release decisions.

### 3A. Rename client configuration to admin configuration

Canonical public names:

| Old | New |
|---|---|
| `ClientConfig` | `AdminConfig` |
| `ResolvedClientConfig` | `ResolvedAdminConfig` |
| `defineClientConfig()` | `defineAdminConfig()` |
| `getClientConfig()` | `getAdminConfig()` |

Tasks:

- [x] Rename the types, functions, global singleton symbols, internal helpers,
  error messages, and comments in `@byline/core`.
- [x] Update all consumers in `@byline/admin`, `@byline/client`,
  `@byline/host-tanstack-start`, `@byline/richtext-lexical`, tests, and examples.
- [x] Preserve `getCollectionAdminConfig()`; its name is already accurate.
- [x] Preserve the SSR fallback behavior under `getAdminConfig()`, but document
  that it carries shared server configuration with empty admin presentation.
- [x] Update `apps/webapp/byline/admin.config.ts` and all CLI templates.
- [x] Update all three downstream `admin.config.ts` files and `_byline` route
  comments/import-registration descriptions.
- [x] Rename
  `docs/09-admin-ui/02-client-config-registration.md` to
  `docs/09-admin-ui/02-admin-config-registration.md` and update its title and
  inbound source links, but retain frontmatter
  `path: "client-config-registration"` by default. This gives the document an
  accurate source identity without breaking its published URL.
- [x] If the published path must also become `admin-config-registration`, stop
  and define the CMS document-path migration and old-URL redirect before changing
  the frontmatter. Re-running `import-docs.ts` against only the new path is not a
  migration and may create a duplicate document.
- [x] Add no compatibility aliases for the old names.

### 3B. Rename the Byline admin i18n axis

Canonical authored names:

| Old | New |
|---|---|
| `interfaceLocales` | `adminLocales` |
| `i18n.interface` | `i18n.admin` |
| hardcoded admin default | `defaultAdminLocale` |
| hardcoded content default | `defaultContentLocale` |
| locale `{ code, label }` | locale `{ code, nativeName }` |
| `resolveInterfaceLocale()` | `resolveAdminLocale()` |
| `ResolveInterfaceLocaleOptions` | `ResolveAdminLocaleOptions` |
| `setInterfaceLocaleFn` | `setAdminLocaleFn` |
| `SetInterfaceLocaleInput` | `SetAdminLocaleInput` |
| `SetInterfaceLocaleResult` | `SetAdminLocaleResult` |
| admin service `setInterfaceLocale` | admin service `setAdminLocale` |

Tasks:

- [x] Update `I18nConfig` types, validators, admin translation resolution,
  server functions, and admin UI consumers.
- [x] Rename the public `@byline/i18n` resolver and option type, their root barrel
  exports, tests, README examples, and all host-adapter consumers. Do not leave
  the package API saying “interface” after its configuration axis says “admin.”
- [x] Rename the host server function and admin-service input/result types and
  method listed above. Preserve host-application names such as
  `useInterfaceLocale()` where “interface” intentionally describes that host's
  public frontend rather than Byline's admin chrome.
- [x] In every application and CLI locale template, retain a top-level exported
  `contentLocales` tuple whose entries contain a static string `code`. This is a
  CLI source contract.
- [x] Define `defaultAdminLocale` and `defaultContentLocale` beside the locale
  tuples and derive `i18n.admin` / `i18n.content` from them.
- [x] Remove the redundant `label` to `nativeName` mapping by authoring
  `nativeName` directly.
- [x] Update public host consumers from `locale.label` to `locale.nativeName`.
- [x] Keep the host frontend's own `i18nConfig.defaultLocale` semantically
  independent. If an application requires it to equal `defaultContentLocale`,
  express that as an application test or explicit assignment rather than a
  framework invariant.
- [x] Update CLI static-config tests to prove the parser still reads
  `contentLocales[*].code` after the non-code property rename.
- [x] Add or retain explicit CLI contract tests for both pinned source shapes:
  `contentLocales[*].code` in `byline/locales.ts`, and
  `i18nConfig.{locales, defaultLocale}` in
  `src/i18n/i18n-config.ts`. Verify unrelated exports and properties remain
  ignored.
- [x] Land and verify this i18n rename separately from Phase 3A. Do not make its
  breadth look mechanical by hiding it inside the `AdminConfig` rename.
- [x] Do not migrate or rename `byline_admin_users.preferred_locale`. It stores a
  locale code, not the name of the configuration axis, and its values remain
  valid. Update surrounding comments/docs to call it the admin user's preferred
  locale. No database or data migration is required for this phase.

### 3C. Remove Byline's duplicated `serverURL`

Target ownership:

- `BaseConfig`, `ServerConfig`, and `AdminConfig`: no public-site or transport
  origin.
- Host public config: the single owner used by public sitemap, metadata,
  markdown, `llms.txt`, and optional admin-to-public navigation.
- `createSignInRoute`: optional `{ homeUrl?: string }` host integration input.
- Future remote SDK: independent `baseURL`/`apiURL`, out of scope here.

Tasks:

- [x] Remove `serverURL` from `BaseConfig`, resolved config types, SSR fallback
  construction, config key contract tests, and every admin/server bootstrap.
- [x] Add an optional second argument to `createSignInRoute(path, options)` with
  `options.homeUrl?: string`, and pass it directly through `SignInPage` to the
  existing optional `SignInForm.homeUrl` prop. This static client-safe value is
  available during SSR and hydration without reading Byline configuration.
- [x] In the reference app, call the route factory with
  `getPublicConfig().serverUrl`. Allow generated templates and applications that
  do not want a Home link to omit the option.
- [x] Audit all three downstream applications and opt them into `homeUrl` from
  their own client-safe public config where that config exists. Do not create a
  second canonical-origin setting solely for Byline.
- [x] Remove `DEFAULT_SERVER_URL` from `byline/routes.ts`; routes do not own site
  identity. Retain or rename the host's existing `VITE_SERVER_URL` only as a host
  application concern, outside Byline config and CLI Byline templates.
- [x] Update CLI admin and database-dialect server templates so neither emitted
  Byline config calculates or accepts a site URL. Update the sign-in route
  template to demonstrate the optional host hook only if the generated host
  template has a concrete client-safe public-config source.
- [x] Add no `apiURL` replacement in this phase.

### Phase 3 verification

- [x] `rg` finds none of the old configuration symbol names in source, templates,
  or current docs except an explicit upgrade guide/changelog comparison.
- [x] `rg` finds no `i18n.interface` or `interfaceLocales` in current source.
- [x] `rg` finds no `serverURL` or `DEFAULT_SERVER_URL` in Byline configuration,
  package source, or Byline templates except migration notes. Host-owned
  `serverUrl`/`VITE_SERVER_URL` may remain in application public configuration.
- [x] CLI route generation and static locale parsing tests pass.
- [x] Public/admin bundle boundary tests pass.
- [x] All four repositories typecheck and build against the same framework API.

---

## Phase 4: Documentation, upgrade guide, and release coordination

Framework documentation to update includes at least:

- `docs/01-getting-started/03-configuration.md`
- `docs/01-getting-started/04-upgrading-to-v4.md` or a new breaking-upgrade page
- `docs/03-architecture/02-core-composition.md`
- `docs/04-collections/*` references to `ClientConfig` or the deprecated aliases
- `docs/05-reading-and-delivery/02-routing-and-api.md`
- `docs/05-reading-and-delivery/03-transports.md`
- `docs/05-reading-and-delivery/05-mcp-server.md`
- `docs/08-internationalization/*`
- `docs/09-admin-ui/02-admin-config-registration.md` after the source rename;
  retain its existing `client-config-registration` frontmatter path unless a
  separate URL migration is approved
- `docs/10-api-reference/01-configuration.md`

Tasks:

- [x] Land the documentation relevant to each delivery slice with that slice;
  this phase is a completeness audit, not permission to defer contract docs
  until after code ships.
- [x] Explain the final three authored boundaries: static public host data,
  `AdminConfig`, and `ServerConfig`.
- [x] Explicitly state that `BaseConfig`, `AdminConfig`, `ServerConfig`, and
  `CollectionDefinition` are live runtime contracts, not wire formats.
- [x] State that future HTTP/MCP manifests are allowlisted projections, not
  serialized runtime configuration.
- [x] Add a mechanical migration table for every renamed/deleted public symbol.
- [x] Update copied documentation in `bylinecms.app` if it is intentionally kept
  in sync with the framework documentation.
- [x] Add changesets for every affected published package. Keep changesets scoped
  to packages whose public surface actually changed.
- [x] Determine merge/release order so no production branch temporarily consumes
  a mismatched framework version.

---

## Implementation record

The three remaining unchecked Phase 1 items are deliberate follow-ups rather
than release blockers: no public consumer currently needs a content-default
export, and the Knip public-export report needs a reviewed allowlist before it
can become useful CI signal.

Branches:

- `bylinecms.dev`: `feat/configuration-surface-cleanup`
- all three downstream applications: `feat/byline-configuration-cleanup`

The implementation used signed, independently scoped commits for serializer
deletion, public-facade narrowing, compatibility removal, admin configuration
renaming, admin i18n renaming, downstream migrations, copied documentation, and
specification progress. Changesets schedule the fixed Byline package group for
the coordinated 5.x major release.

All four repositories were verified against the same locally linked, fully built
Byline package graph. The primary repository passed generation, lint, typecheck,
unit tests, production build, Knip, the non-blocking public-export audit,
documentation checks, and changeset status. Each downstream passed generation,
lint, typecheck, and production build; the repositories with tests passed their
configured suites. Modulus also gained the missing Biome exclusion for its
generated collection types after the final gate exposed a formatter/generator
conflict.

Release order:

1. Merge the framework pull request and publish the coherent 5.x package set
   from the committed changesets.
2. Update each downstream package manifest and lockfile to the published 5.x
   versions on its prepared migration branch.
3. Rerun the downstream gates without local links, merge the downstream pull
   requests, and deploy them independently.

Do not merge a downstream migration while its manifest still resolves Byline
4.x. The prepared source commits deliberately omit an unresolvable `^5.0.0`
lockfile update before the packages exist.

Published draft pull requests:

- `Byline-CMS/bylinecms.dev#74`
- `Byline-CMS/bylinecms.app#1`
- `Modulus-Learning/modulus-learning.org#1`
- `infonomic/beta.forru.org#1`

All implementation branches are pushed and clean. The three downstream pull
requests remain drafts until the framework 5.x package set is published and
their manifests and lockfiles can be updated from 4.x to the released versions.

---

## Final verification gates

### `bylinecms.dev`

Use executable configuration as the source of truth. At minimum:

```bash
pnpm byline:generate:check
pnpm lint
pnpm typecheck
pnpm knip
pnpm knip:exports
pnpm test
pnpm build
pnpm docs:check
git diff --check
```

Notes:

- `pnpm lint` writes fixes; inspect its diff.
- A successful `pnpm build` may include known Lexical/Rolldown
  `INVALID_ANNOTATION` warnings; use the exit status.
- Run relevant focused package tests before the full gates while iterating.

### Each downstream application

From each repository root:

```bash
pnpm byline:generate:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

For `beta.forru.org`, root `pnpm test` does not run webapp tests. Also run:

```bash
pnpm --filter @forru/webapp exec vitest run
pnpm --filter @forru/webapp exec vitest run --mode=node
```

Do not run database initialization, migrations, content migration, S3 cleanup, or
other operational commands for this configuration-only work.

## Acceptance criteria

- The unsafe serializer and its types no longer exist anywhere in the known
  framework/application estate.
- No deprecated compatibility surface listed in Phase 2 remains.
- `AdminConfig` is the only name for admin presentation configuration; no current
  API calls it generic client configuration.
- The admin i18n axis is unmistakably named and remains distinct from each host's
  public frontend i18n axis.
- Public host code imports only static content-locale and route data through
  `public.ts`; no registration order or network request is required.
- Byline runtime configuration exposes no public-site origin and no
  remote-transport endpoint. The host's public configuration supplies optional
  sign-in `homeUrl` directly through the route factory.
- CLI templates generate the final configuration shape and continue to parse
  static content locale codes.
- The dead-public-export audit makes new unused entry-barrel exports visible for
  review without pretending that repository-local use proves external use.
- All four repositories pass their verification gates against one coherent set of
  package versions.
- HTTP/MCP descriptor design remains deferred, with documentation explicitly
  requiring a future allowlisted projection.
