/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SessionProvider } from '@byline/auth'

import type { SlugifierFn } from '../utils/slugify.js'
import type { CollectionAdminConfig } from './admin-types.js'
import type { CollectionDefinition } from './collection-types.js'
import type { IDbAdapter } from './db-types.js'
import type { RichTextEditorComponent, RichTextEmbedFn, RichTextPopulateFn } from './field-types.js'
import type { IStorageProvider } from './storage-types.js'

export type DbAdapterFn = (args: { connectionString: string }) => IDbAdapter

/**
 * URL path segments for the admin and (future) public API routes.
 * Both values are optional on the input side — callers typically read the
 * resolved shape via `resolveRoutes()` which fills in `'/admin'` and `'/api'`
 * defaults.
 */
export interface RoutesConfig {
  admin: string
  api: string
}

/**
 * Common configuration shared by the server and client. Contains only
 * serializable, framework-agnostic properties — no React components, no
 * database adapters, no storage providers.
 */
export interface BaseConfig {
  serverURL: string
  i18n: {
    interface: {
      defaultLocale: string
      locales: string[]
      /**
       * Optional display names for the admin language switcher. Each
       * entry pairs a permitted locale code with the label users see
       * in the menu — `Français` rather than the lowercase `français`
       * that CLDR's `Intl.DisplayNames` returns for romance languages.
       *
       * Hosts that omit this fall back to `Intl.DisplayNames` per
       * code; hosts that provide it for some codes still fall back
       * for the rest. Entries for codes outside `locales` are silently
       * ignored.
       */
      localeDefinitions?: ReadonlyArray<{ code: string; nativeName: string }>
    }
    content: {
      /**
       * The default **content** locale: the locale new documents are authored
       * in, and the locale served for a request that doesn't specify one.
       *
       * As of the source_locale work this is **no longer the per-document data
       * anchor.** Each document records its own `source_locale` at creation
       * (= this value at that moment) and rides it for the read fallback floor,
       * its path locale, and the completeness ledger — so changing this value
       * is safe for existing data: they keep reading against the locale they
       * were authored in. New documents created after the change anchor to the
       * new value. See docs/I18N.md.
       *
       * (Switching this on a live system still needs the one-time
       * `backfillSourceLocales()` maintenance step to have stamped any rows
       * that predate the `source_locale` column.)
       */
      defaultLocale: string
      locales: string[]
      /**
       * Optional display names for the content locales a document can be
       * published in. Mirrors `interface.localeDefinitions`, but for the
       * *content* dimension rather than the admin chrome.
       *
       * Byline itself does not render these — the content-locale set has
       * no admin switcher. They exist so a host frontend can advertise
       * content languages (hreflang clusters, "read this in…" affordances,
       * sitemap alternates) with author-controlled labels — `Français`
       * rather than the lowercase `français` that CLDR's
       * `Intl.DisplayNames` returns for romance languages — read straight
       * off `getServerConfig().i18n.content.localeDefinitions` instead of
       * maintaining a parallel label map.
       *
       * Hosts that omit this can resolve labels per-code via
       * `Intl.DisplayNames`; hosts that provide it for some codes still
       * fall back for the rest. Entries for codes outside `locales` are
       * silently ignored.
       */
      localeDefinitions?: ReadonlyArray<{ code: string; nativeName: string }>
    }
    /**
     * Admin interface translation registry — a `TranslationBundle`
     * produced by `@byline/i18n`'s `mergeTranslations(...)`. Locale →
     * namespace → key → ICU MessageFormat-encoded string.
     *
     * Optional at the type level so `BaseConfig` stays loose for tests
     * and seed scripts; required at runtime via `validateTranslations`
     * whenever `interface.locales` is non-empty. See `docs/I18N.md` for
     * the design.
     *
     * The shape is declared inline (rather than imported from
     * `@byline/i18n`) so `@byline/core` stays a leaf-ish package. The
     * `TranslationBundle` type from `@byline/i18n` is structurally
     * assignable to this slot.
     */
    translations?: TranslationBundleShape
  }
  collections: CollectionDefinition[]
  /**
   * URL segments for admin and API routes. Both keys default to `/admin`
   * and `/api` respectively — installations only set this when they want
   * to mount the admin or API at a non-default path. Consumers should
   * read these via `resolveRoutes()` so the defaults are always applied.
   */
  routes?: Partial<RoutesConfig>
}

/**
 * Inline structural shape for the admin translation registry. Kept here
 * (rather than imported from `@byline/i18n`) so `@byline/core` doesn't
 * take a runtime dep on the i18n package. `@byline/i18n`'s
 * `TranslationBundle` is structurally identical and assignable.
 */
export type TranslationBundleShape = Readonly<{
  [locale: string]: Readonly<{
    [namespace: string]: Readonly<{ [key: string]: string }>
  }>
}>

/**
 * Client-side configuration. Extends BaseConfig with admin UI presentation
 * config (React components, formatters, column definitions, etc.).
 *
 * Used by `defineClientConfig()` and consumed by admin UI routes.
 */
export interface ClientConfig extends BaseConfig {
  /** Admin UI configuration for collections (client-side only). */
  admin?: CollectionAdminConfig[]
  /**
   * Site-wide field-level UI defaults. Currently surfaces the richtext
   * editor adapter slot — additional field-level defaults (custom
   * widgets, formatters, etc.) can be registered here as the system grows.
   *
   * @example
   * ```ts
   * import { RichTextField } from '@byline/richtext-lexical'
   *
   * defineClientConfig({
   *   // ...
   *   fields: {
   *     richText: { editor: RichTextField },
   *   },
   * })
   * ```
   */
  fields?: {
    /**
     * Editor component used to render every `type: 'richText'` field. Per-field
     * overrides via `FieldAdminConfig.components.Field` continue to take
     * precedence over this site-wide default.
     */
    richText?: { editor: RichTextEditorComponent }
  }
}

/**
 * Server-side configuration. Extends BaseConfig with database and storage
 * adapters. Deliberately does NOT extend ClientConfig — the server has no
 * knowledge of React components or admin UI presentation logic.
 *
 * Generic over `TAdminStore` so installations can thread an adapter-built
 * admin store (users / roles / permissions / refresh tokens) through
 * `initBylineCore()` without `@byline/core` depending on `@byline/admin` —
 * which would invert the package dependency direction. Callers that
 * consume admin functionality pass `AdminStore` from `@byline/admin`;
 * callers that do not leave the default `unknown`.
 */
export interface ServerConfig<TAdminStore = unknown> extends BaseConfig {
  db: IDbAdapter
  /**
   * Site-wide default storage provider for upload-capable image/file
   * fields.
   *
   * This is the fallback used when a field's own `UploadConfig.storage`
   * is not set. Individual fields can override this by specifying
   * `storage` inside their `upload` config block.
   *
   * Resolution order:
   *   1. `field.upload.storage`   — per-field override
   *   2. `ServerConfig.storage`   — site-wide default
   *   3. 500 error if neither is set
   *
   * @example
   * ```ts
   * import { localStorageProvider } from '@byline/storage-local'
   * storage: localStorageProvider({ uploadDir: './uploads', baseUrl: '/uploads' })
   * ```
   */
  storage?: IStorageProvider
  /**
   * Installation-wide slugifier used to derive a document's `path` (stored
   * in `byline_document_paths`) from the field named by
   * `CollectionDefinition.useAsPath`.
   *
   * Falls back to the default `slugify` from `@byline/core` when not set.
   * Must be pure and synchronous — it runs server-side at write time and
   * client-side for live form preview, and the two must agree on output.
   */
  slugifier?: SlugifierFn
  /**
   * Session provider for admin authentication. Optional in Phase 3 —
   * installations without a provider configured simply can't sign in
   * (sign-in / verify / refresh / revoke all require one); everything
   * else continues to work. Phase 5 wires the admin server-fn middleware
   * and will tighten this where authentication is required.
   *
   * The built-in `JwtSessionProvider` from `@byline/admin/auth` covers
   * the default case. Alternative providers can adapt Lucia, better-auth,
   * WorkOS, Clerk, or institutional SSO by implementing the
   * `SessionProvider` interface from `@byline/auth` — those adapters
   * should ship as separate packages rather than being added to
   * `@byline/admin`.
   *
   * @example
   * ```ts
   * import { JwtSessionProvider } from '@byline/admin/auth'
   * import { createAdminStore } from '@byline/db-postgres/admin'
   *
   * sessionProvider: new JwtSessionProvider({
   *   store: createAdminStore(drizzleDb),
   *   signingSecret: process.env.BYLINE_JWT_SECRET!,
   * })
   * ```
   */
  sessionProvider?: SessionProvider
  /**
   * Adapter-built bundle of admin repositories (users / roles /
   * permissions / refresh tokens). Typically constructed via the
   * adapter's `createAdminStore(...)` factory and shared with the
   * session provider so both sides talk to the same repository
   * instances.
   *
   * Surfaced unchanged as `BylineCore.adminStore` so server fns, seeds,
   * and future admin commands can reach it without holding a second
   * reference or casting the adapter. Optional — installations without
   * admin UI can leave it unset.
   *
   * @example
   * ```ts
   * import type { AdminStore } from '@byline/admin'
   * import { createAdminStore } from '@byline/db-postgres/admin'
   *
   * const db = pgAdapter({ ... })
   * const adminStore = createAdminStore(db.drizzle)
   * const core = await initBylineCore<AdminStore>({ db, adminStore, ... })
   * // core.adminStore is typed as AdminStore
   * ```
   */
  adminStore?: TAdminStore
  /**
   * Site-wide field-level server adapter slots. Mirrors
   * `ClientConfig.fields` for the server side — each entry plugs an
   * adapter package into a framework-managed read or write phase.
   *
   * @example
   * ```ts
   * import {
   *   lexicalEditorEmbedServer,
   *   lexicalEditorPopulateServer,
   * } from '@byline/richtext-lexical/server'
   *
   * defineServerConfig({
   *   fields: {
   *     richText: {
   *       embed: lexicalEditorEmbedServer({ getClient: getAdminBylineClient }),
   *       populate: lexicalEditorPopulateServer({ getClient: getAdminBylineClient }),
   *     },
   *   },
   * })
   * ```
   */
  fields?: {
    /**
     * Richtext server-side adapter slots.
     *
     * `populate` — invoked by the read pipeline for every rich-text field
     * whose effective `populateRelationsOnRead` is `true`. Required when
     * any collection has a `richText` field configured to populate on
     * read; `initBylineCore()` enforces this.
     *
     * `embed` — invoked by the document-lifecycle write path for every
     * rich-text field whose effective `embedRelationsOnSave` is `true`
     * (the default). Walks the editor tree at save time and refreshes
     * embedded relation envelopes (e.g. composing `document.path` via
     * `CollectionDefinition.buildDocumentPath` on internal-link nodes).
     * Required when any collection has a `richText` field with
     * `embedRelationsOnSave: true`; `initBylineCore()` enforces this.
     */
    richText?: { populate?: RichTextPopulateFn; embed?: RichTextEmbedFn }
  }
}
