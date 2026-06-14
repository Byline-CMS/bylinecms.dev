/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `webapp-media-admin` namespace bundle for the custom media list view.
 *
 * This file is the canonical example of how to extend Byline's
 * `@byline/i18n` system with translations for a custom component —
 * the same pattern any third-party plugin, richtext extension, or
 * custom field would follow. Each locale lives in its own JSON file
 * for translator tooling friendliness; the factory below assembles the
 * locale-keyed `TranslationBundle` shape Byline merges at boot.
 *
 * Composition in `apps/webapp/byline/i18n.ts`:
 *
 * ```ts
 * translations: mergeTranslations(
 *   adminTranslations({ locales }),
 *   mediaAdminTranslations({ locales }),
 * )
 * ```
 *
 * Components address the namespace via `useTranslation('webapp-media-admin')`.
 * `mergeTranslations` is last-writer-wins, so an extension that wants to
 * override a key from `byline-admin` can do so by emitting the same
 * namespace + key — though dropping a new namespace (as we do here) is
 * the recommended pattern, since collisions are reported to the host's
 * `onCollision` callback and grow noisy if widely used.
 */

import type { LocaleCode, NamespaceTranslations, TranslationBundle } from '@byline/i18n'
import { mergeTranslations } from '@byline/i18n'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import it from './it.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

/**
 * The namespace this extension owns. Pick a globally-unique string —
 * by convention `<app-or-package-slug>-<purpose>` — so it can't
 * collide with `byline-admin` or with any other extension installed
 * alongside this one.
 */
export const MEDIA_ADMIN_NAMESPACE = 'webapp-media-admin'

const BUNDLES: Readonly<Record<LocaleCode, NamespaceTranslations>> = {
  en: en as NamespaceTranslations,
  fr: fr as NamespaceTranslations,
  es: es as NamespaceTranslations,
  de: de as NamespaceTranslations,
  it: it as NamespaceTranslations,
  'zh-CN': zhCN as NamespaceTranslations,
  ko: ko as NamespaceTranslations,
}

/** Locale codes for which this extension ships a translation in-tree. */
export const bundledLocales: readonly LocaleCode[] = Object.freeze(Object.keys(BUNDLES))

export interface MediaAdminTranslationsOptions {
  /**
   * Locale codes to include in the returned bundle. Each must appear in
   * `bundledLocales` above — unknown codes throw at config time.
   * Defaults to `['en']` when omitted, which is always available.
   */
  locales?: readonly LocaleCode[]
}

/**
 * Build a `TranslationBundle` carrying the `webapp-media-admin`
 * namespace for each requested locale. Compose with the built-in
 * `adminTranslations({...})` via `mergeTranslations(...)` in the
 * host's `byline/i18n.ts`.
 *
 * @throws when a requested code is not in `bundledLocales`.
 */
export function mediaAdminTranslations(
  options: MediaAdminTranslationsOptions = {}
): TranslationBundle {
  const locales = options.locales ?? ['en']
  const partials: TranslationBundle[] = []
  for (const locale of locales) {
    const bundle = BUNDLES[locale]
    if (bundle == null) {
      throw new Error(
        `[mediaAdminTranslations] no bundled translation for locale '${locale}'. ` +
          `Available: [${bundledLocales.join(', ')}]. ` +
          `To add a locale, drop a new JSON file alongside en.json / fr.json and ` +
          `register it in the BUNDLES map.`
      )
    }
    partials.push({ [locale]: { [MEDIA_ADMIN_NAMESPACE]: bundle } })
  }
  return mergeTranslations(...partials)
}
