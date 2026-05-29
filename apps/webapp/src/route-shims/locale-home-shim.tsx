/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Shared helpers for the literal-locale home shim routes.
 *
 * Why these shims exist
 * ---------------------
 * The `{-$lng}/_frontend/$path` catch-all and the `{-$lng}/_frontend/`
 * index are siblings of an optional segment. For a bare-locale URL
 * like `/es`, TanStack's matcher scoring (`statics > dynamics >
 * optionals`) picks `$path` (dynamic 'es') over the index (optional
 * 'es'). There is no per-route knob to override this — `params.parse`
 * throwing `notFound()` is terminal, not "try next candidate", and
 * `params.priority` only sorts dynamic siblings.
 *
 * The workaround is structural: mount an *additional* route at the
 * literal `/<locale>` URL for each non-default locale. A literal
 * segment is a static, which beats both dynamics and optionals, so
 * `/es` deterministically renders the localized home via the shim.
 * Deeper URLs like `/es/about-us` still resolve via the optional-lng
 * tree (the shim defines no `$path`), so root-level CMS page slugs
 * keep working unchanged.
 *
 * Wired through `routes.virtual.ts` and `tanstackStart({ router:
 * { virtualRouteConfig } })` in `vite.config.ts`.
 */

import { TranslationsProvider } from '@/i18n/client/translations-provider'
import { getTranslations, type Translations } from '@/i18n/translations'
import { buildLocalizedPath, getMeta } from '@/lib/meta'
import { HomeView } from '@/modules/home/home-view'
import { RouteProgressBar } from '@/ui/components/route-progress-bar'
import { FrontendLayout } from '@/ui/layouts/frontend-layout'
import {
  type FrontendLayoutData,
  loadFrontendLayoutData,
} from '@/ui/layouts/frontend-layout-loader'
import type { Locale } from '@/i18n/i18n-config'

export interface LocaleHomeShimData extends FrontendLayoutData {
  translations: Translations
  locale: Locale
}

export async function loadLocaleHomeShimData(locale: Locale): Promise<LocaleHomeShimData> {
  // Translations + admin/layout reads are independent — fetch in parallel.
  const [translations, layoutData] = await Promise.all([
    getTranslations(locale),
    loadFrontendLayoutData(),
  ])
  return { translations, locale, ...layoutData }
}

export function localeHomeShimHead(loaderData: LocaleHomeShimData | undefined) {
  if (loaderData == null) return getMeta()
  return getMeta({ path: buildLocalizedPath(loaderData.locale) })
}

export function LocaleHomeShimComponent({ data }: { data: LocaleHomeShimData }) {
  const { translations, locale, adminUser, adminPath, preview } = data
  return (
    <TranslationsProvider translations={translations}>
      <RouteProgressBar />
      <FrontendLayout adminUser={adminUser} adminPath={adminPath} preview={preview} locale={locale}>
        <HomeView />
      </FrontendLayout>
    </TranslationsProvider>
  )
}
