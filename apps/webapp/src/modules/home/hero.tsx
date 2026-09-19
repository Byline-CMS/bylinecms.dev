/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Home page hero. Placeholder copy for a fictitious site — the point is to
 * show the shape of a Byline installation's home page, not to describe a
 * real product. Swap the headline, lead, and calls to action for your own.
 */

import { Button, Container, Section } from '@byline/ui/react'

import { routes } from '~/public'

import { useTranslations } from '@/i18n/client/translations-provider'
import { LangLink } from '@/i18n/components/lang-link'

export function Hero() {
  const { t } = useTranslations('frontend')

  return (
    <Section className="mx-auto flex flex-col items-center justify-center px-6 pt-14 pb-10 text-center md:pt-[9vh] md:pb-16">
      <Container>
        <p className="m-0 mb-7 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-gray-900/15 bg-gray-900/5 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-gray-700 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            {t('heroBadge')}
          </span>
        </p>

        <h1 className="mb-6 text-5xl font-bold tracking-tight sm:text-5xl md:text-6xl">
          {t('heroTitleLead')}&nbsp;
          <span className="bg-gradient-to-r from-purple-400 via-pink-500 to-amber-500 bg-clip-text text-transparent">
            {t('heroTitleAccent')}
          </span>
        </h1>

        <p className="mx-auto mb-8 max-w-2xl text-balance text-lg text-gray-900 dark:text-gray-200 sm:text-xl">
          {t('heroTagline')}
        </p>

        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button
            variant="gradient"
            size="lg"
            className="min-w-[220px] no-underline"
            render={<LangLink to="/docs" />}
          >
            {t('heroCtaDocs')}
          </Button>
          <Button
            variant="outlined"
            size="lg"
            className="min-w-[220px] no-underline"
            render={<LangLink to={routes.admin} />}
          >
            {t('heroAdminDashboard')}
          </Button>
        </div>
      </Container>
    </Section>
  )
}
