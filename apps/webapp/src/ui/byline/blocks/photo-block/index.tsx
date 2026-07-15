'use client'

import type React from 'react'

import { Container, FadeInLift } from '@byline/ui/react'
import cx from 'classnames'

import { ResponsiveImage } from '@/ui/byline/components/responsive-image'
import { LexicalRichText } from '@/ui/byline/components/richtext-lexical'
import type { Locale } from '@/i18n/i18n-config'
import type { PopulatedPhotoBlockData } from '@/lib/content-types'

interface Props {
  id: string
  block: PopulatedPhotoBlockData
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

  // Missing, unresolved, and cycle-suppressed relations have no document.
  const media = photo?.document?.fields
  if (media == null) return null

  const Comp = display === 'full_width' ? 'div' : Container

  const captionRoot =
    caption != null && !Array.isArray(caption) && typeof caption === 'object'
      ? caption.root
      : undefined
  const captionChildren =
    captionRoot != null && !Array.isArray(captionRoot) && typeof captionRoot === 'object'
      ? captionRoot.children
      : undefined

  return (
    <Comp
      id={id}
      className={cx(
        'px-0',
        {
          'lg:max-w-[920px] xl:max-w-[920px] 2xl:max-w-[920px] mx-auto': display === 'default',
        },
        className
      )}
    >
      <FadeInLift as="div" delay={0.25}>
        <ResponsiveImage
          image={media.image}
          size="large"
          constrainedLayout={constrainedLayout}
          alt={alt ?? media.altText ?? ''}
          className="photo-block"
          imgClassName="photo-block--photo"
        />
        {captionChildren != null && (
          <Container className={cx('py-2', { 'px-0': constrainedLayout })}>
            <div className="photo-block--caption [&_p]:m-0 muted text-[1rem]">
              <LexicalRichText lng={lng} nodes={captionChildren} />
            </div>
          </Container>
        )}
      </FadeInLift>
    </Comp>
  )
}
