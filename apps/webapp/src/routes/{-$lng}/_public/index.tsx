/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createFileRoute } from '@tanstack/react-router'

// NOTE: This will restrict our retrieved content to front-end interface locales
// defined in i18nConfig, which is not exactly what we want. We want the available
// locales to be determined by the content locales in the CMS, but this is a
// good starting point for now until we settle on a content locale vs interface
// locale fallback or detection strategy.
import { i18nConfig, type Locale } from '@/i18n/i18n-config'
import { EditorAnimation } from '@/modules/home/editor-animation'
import { FeatureGrid } from '@/modules/home/feature-grid'
import { HeroTagline } from '@/modules/home/hero-tagline'

export const Route = createFileRoute('/{-$lng}/_public/')({
  component: Index,
})

function Index() {
  const { lng: lngParam } = Route.useParams()
  const lng = (i18nConfig.locales as readonly string[]).includes(lngParam ?? '')
    ? (lngParam as Locale)
    : i18nConfig.defaultLocale
  return (
    <>
      <HeroTagline />
      <EditorAnimation />
      <FeatureGrid />
    </>
  )
}
