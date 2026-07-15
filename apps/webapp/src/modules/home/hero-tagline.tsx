import { resolveRoutes } from '@byline/core'
import { Container, Section } from '@byline/ui/react'

import { routes } from '~/public'

import { useTranslations } from '@/i18n/client/translations-provider'
import { LangLink } from '@/i18n/components/lang-link'

export function HeroTagline() {
  const { t } = useTranslations('frontend')
  return (
    <Section className="mx-auto flex flex-col items-center justify-center px-6 pt-14 text-center md:pt-22">
      <Container>
        <h1 className="mb-6 text-5xl font-bold tracking-tight sm:text-5xl md:text-6xl">
          Byline&nbsp;
          <span className="bg-gradient-to-r from-purple-400 via-pink-500 to-amber-500 bg-clip-text text-transparent">
            CMS
          </span>
        </h1>
        <p className="mb-4 max-w-2xl text-lg text-gray-900 dark:text-gray-200 sm:text-xl text-balance mx-auto">
          {t('heroTagline')}
        </p>
        <p className="m-0 mb-6 text-center underline flex gap-4 items-center justify-center">
          <LangLink to={resolveRoutes(routes).admin}>{t('heroAdminDashboard')}</LangLink>
          <LangLink to="/news">{t('navNews')}</LangLink>
        </p>
      </Container>
    </Section>
  )
}
