/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Home page introduction and capability cards. The two body paragraphs are
 * deliberately lorem ipsum — they mark the spot where a real installation
 * writes about itself, without pretending to say anything.
 */

import { Card, Container, Section } from '@byline/ui/react'

import { useTranslations } from '@/i18n/client/translations-provider'
import { SectionHeader } from '@/modules/home/section-header'
import type { Translations } from '@/i18n/translations'

const features: ReadonlyArray<{
  titleKey: keyof Translations['frontend']
  bodyKey: keyof Translations['frontend']
}> = [
  { titleKey: 'featureStructuredTitle', bodyKey: 'featureStructuredBody' },
  { titleKey: 'featureVersionedTitle', bodyKey: 'featureVersionedBody' },
  { titleKey: 'featureMultilingualTitle', bodyKey: 'featureMultilingualBody' },
]

export function Intro() {
  const { t } = useTranslations('frontend')

  return (
    <>
      <Section className="px-6 py-12 sm:py-16">
        <Container>
          <SectionHeader kicker={t('introKicker')} title={t('introTitle')} intro={t('introLead')} />
          <div className="mx-auto grid max-w-4xl gap-6 text-gray-700 dark:text-gray-300 sm:grid-cols-2">
            <p className="m-0 leading-relaxed">{t('introBodyOne')}</p>
            <p className="m-0 leading-relaxed">{t('introBodyTwo')}</p>
          </div>
        </Container>
      </Section>

      <Section className="px-6 py-12 sm:py-16">
        <Container>
          <SectionHeader
            kicker={t('featuresKicker')}
            title={t('featuresTitle')}
            intro={t('featuresIntro')}
          />
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <Card key={feature.titleKey} className="h-full p-6">
                <span
                  className="mb-4 block h-1 w-10 rounded-full bg-gradient-to-r from-purple-400 via-pink-500 to-amber-500"
                  aria-hidden="true"
                />
                <h3 className="m-0 mb-2 text-lg font-semibold">{t(feature.titleKey)}</h3>
                <p className="m-0 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                  {t(feature.bodyKey)}
                </p>
              </Card>
            ))}
          </div>
        </Container>
      </Section>
    </>
  )
}
