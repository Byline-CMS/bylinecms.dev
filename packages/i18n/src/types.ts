/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Locale code — kept as a plain `string` so the package stays open to
 * any BCP 47 tag (`en`, `pt-BR`, `zh-Hans-CN`). The host's
 * `i18n.interface.locales` config is the canonical allow-list at
 * runtime; the resolver / validator narrow against it.
 */
export type LocaleCode = string

/**
 * Lightweight locale definition used by `<LanguageMenu>` to render the
 * dropdown. The `code` matches a string in `i18n.interface.locales`;
 * the `nativeName` is what the user sees ("English", "Español",
 * "Français", "Deutsch", "日本語").
 */
export interface LocaleDefinition {
  code: LocaleCode
  nativeName: string
}

/**
 * Namespace string — convention is `byline-<package>` for Byline-shipped
 * code and `<org>-<plugin>` for third-party plugins. The runtime treats
 * namespaces as opaque keys.
 */
export type Namespace = string

/**
 * Message key inside a namespace — dot-segmented by convention
 * (`chrome.sidebar.collapse`), but the runtime treats keys as opaque.
 */
export type MessageKey = string

/**
 * One namespace's translations for one locale — flat key → ICU
 * MessageFormat-encoded string.
 */
export type NamespaceTranslations = Readonly<Record<MessageKey, string>>

/**
 * The complete translation registry: locale → namespace → key →
 * ICU-encoded message. Built by `mergeTranslations(...)`, passed to
 * `<I18nProvider>`, and validated at boot by `@byline/core`.
 *
 * Bundles are deliberately plain JSON-shaped data — no functions, no
 * React, no per-key metadata — so they can be authored as `.json`
 * files, published as standalone npm packages, and round-tripped
 * through any translation tool. Authoring-time metadata
 * (descriptions, plural hints, deprecation markers) is a deferred
 * Phase 4 surface; see `docs/07-internationalization/index.md`.
 */
export type TranslationBundle = Readonly<{
  [locale: LocaleCode]: Readonly<{
    [namespace: Namespace]: NamespaceTranslations
  }>
}>

/**
 * Values argument to `t(key, values)`. `intl-messageformat` accepts
 * strings, numbers, booleans, Dates, and React elements — but we narrow
 * the public API to JSON-safe primitives + Date so the `t` return type
 * stays `string`. Rich-element interpolation (e.g. inline links) goes
 * through a separate `<Trans>` component (not part of the PR 1 surface).
 */
export type TranslationValues = Readonly<Record<string, string | number | boolean | Date | null>>
