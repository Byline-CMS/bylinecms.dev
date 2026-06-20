/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { ResponsiveImage } from '@/ui/byline/components/responsive-image'
import { RenderBlocks } from '@/ui/byline/render-blocks'
import type { Locale } from '@/i18n/i18n-config'
import type { DocDetailsResult } from '@/modules/docs/details'

interface DocDetailsProps {
  lng: Locale
  result: NonNullable<DocDetailsResult>
}

export function DocDetails({ result, lng }: DocDetailsProps) {
  const { fields } = result
  const title = fields.title ?? result.path ?? result.id
  const featureMedia = fields.featureImage?.document?.fields
  const featureImage = featureMedia?.image
  const imageAlt = featureMedia?.altText ?? featureMedia?.title ?? title

  return (
    <article className="prose max-w-[920px] mx-auto">
      <header className="mb-0">
        <h1 className="m-0">{title}</h1>
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
      <RenderBlocks lng={lng} blocks={fields.content} constrainedLayout={true} />
    </article>
  )
}
