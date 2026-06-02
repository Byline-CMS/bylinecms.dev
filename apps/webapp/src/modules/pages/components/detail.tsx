/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { Container, Section } from '@byline/ui/react'

import { AvailableLanguages } from '@/i18n/components/available-languages'
import { advertisedLocalesFor } from '@/lib/alternates'
import { ResponsiveImage } from '@/ui/byline/components/responsive-image'
import { RenderBlocks } from '@/ui/byline/render-blocks'
import type { Locale } from '@/i18n/i18n-config'
import type { PageDetailResult } from '@/modules/pages/detail'

interface PageDetailProps {
  lng: Locale
  result: NonNullable<PageDetailResult>
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

export function PageDetail({ result, lng }: PageDetailProps) {
  const { fields } = result
  const title = fields.title ?? result.path ?? result.id
  // Public advertised content-locale set: availableLocales ∩ _availableVersionLocales
  // (see src/lib/alternates.ts) — the same source the hreflang meta derives from.
  const advertisedLocales = advertisedLocalesFor(result)
  const featureMedia = fields.featureImage?.document?.fields
  const featureImage = featureMedia?.image
  const imageAlt =
    (featureMedia?.altText ?? featureMedia?.title ?? title)
      ? dateFormatter.format(new Date(fields.publishedOn))
      : undefined

  return (
    <article className="section-layout content prose w-full max-w-full">
      <Section className="flex flex-col">
        <Container className="pt-[12px]">
          <header className="mb-6">
            <h1 className="m-0">{title}</h1>
            <AvailableLanguages advertisedLocales={advertisedLocales} className="mt-3" />
          </header>
          {featureImage ? (
            <ResponsiveImage
              image={featureImage}
              size="large"
              alt={imageAlt}
              className="mb-6"
              imgClassName="h-auto w-full object-cover"
              loading="eager"
              fetchPriority="high"
            />
          ) : null}
        </Container>
      </Section>
      <RenderBlocks lng={lng} blocks={fields.content} />
    </article>
  )
}
