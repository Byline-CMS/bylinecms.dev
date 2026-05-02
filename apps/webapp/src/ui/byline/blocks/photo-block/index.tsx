'use client'

import type React from 'react'

import { Container, FadeInLift } from '@infonomic/uikit/react'
import cx from 'classnames'

import { PhotoComponent } from '@/ui/byline/components/photo'
import { LexicalRichText } from '@/ui/byline/components/richtext-lexical'
import type { Locale } from '@/i18n/i18n-config'
import type { PhotoBlockData } from '~/blocks/photo-block'
import type { MediaFields } from '~/collections/media/schema'

interface Props {
  id: string
  block: PhotoBlockData
  lng: Locale
  constrainedLayout?: boolean
  className?: string
}

export function PhotoBlock({
  id,
  block,
  lng,
  className,
  constrainedLayout,
}: Props): React.JSX.Element | null {
  const { photo, alt, caption, display } = block

  // The `photo` relation must be populated (`populate: { photo: '*' }`) for
  // the front-end to render an image. When populated, the value is a
  // `PopulatedRelationValue` envelope — `{ ...rel, _resolved: true,
  // document: <MediaFields> }`. Bail out if the relation is missing or
  // unpopulated.
  if (photo == null || (photo as { _resolved?: boolean })._resolved !== true) {
    return null
  }
  const media = (photo as unknown as { document: MediaFields }).document

  const Comp = display === 'full_width' ? 'div' : Container

  // TODO: caption is a Lexical richText field — type properly once the
  // Lexical node shape is modelled in @byline/core.
  const captionDoc = caption as Record<string, any> | undefined

  return (
    <Comp
      id={id}
      className={cx(
        'px-0 pt-4',
        {
          'lg:max-w-[920px] xl:max-w-[920px] 2xl:max-w-[920px] mx-auto': display === 'default',
        },
        className
      )}
    >
      <FadeInLift as="div" delay={0.25}>
        <PhotoComponent
          constrainedLayout={constrainedLayout}
          photo={media}
          // No bleed inside a dedicated photo block — there is no parent
          // text flow to bleed against.
          bleedOnMobile={false}
          position={display}
          alt={alt}
          className="photo-block"
          imgClassName="photo-block--photo"
        />
        {captionDoc != null && (
          <Container
            className={cx('bg-white dark:bg-canvas-900 py-2', { 'px-0': constrainedLayout })}
          >
            <div className="photo-block--caption">
              <LexicalRichText lng={lng} nodes={captionDoc?.root?.children} />
            </div>
          </Container>
        )}
      </FadeInLift>
    </Comp>
  )
}
