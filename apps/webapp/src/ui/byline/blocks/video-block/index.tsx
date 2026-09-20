'use client'

import { useEffect, useRef } from 'react'

import type { PopulatedRelation } from '@byline/client'
import type { VideoBlockData, VideosFields } from '@byline/generated-types'
import { Container, FadeInLift } from '@byline/ui/react'
import cx from 'clsx'

import { LexicalRichText } from '@/ui/byline/components/richtext-lexical'
import { pickVariantUrl } from '@/ui/utils/image-sources'
import type { Locale } from '@/i18n/i18n-config'

/**
 * `video` is the authoritative source document: its poster, alt text and
 * caption drive the player. `videoMobile` contributes a `<source>` and
 * nothing else — a mobile encode is a bandwidth variant of the same footage,
 * so a second poster or caption on it would only be a way for the two to
 * disagree. Editors should leave those fields empty on mobile encodes.
 */
export type PopulatedVideoBlockData = Omit<VideoBlockData, 'video' | 'videoMobile'> & {
  video: PopulatedRelation<VideosFields>
  videoMobile?: PopulatedRelation<VideosFields>
}

interface Props {
  id: string
  block: PopulatedVideoBlockData
  lng: Locale
  constrainedLayout?: boolean
  className?: string
}

/**
 * Structural twin of `PhotoBlock` — same position options, same caption
 * treatment, same `FadeInLift` entrance — so a page mixing the two reads as
 * one thing. Divergences are the player itself and the poster.
 */
export function VideoBlock({
  id,
  block,
  lng,
  className,
  constrainedLayout,
}: Props): React.JSX.Element | null {
  const videoRef = useRef<HTMLVideoElement>(null)

  const video = block.video.document?.fields
  const mobile = block.videoMobile?.document?.fields
  const src = video?.file.storageUrl
  const mobileSrc = mobile?.file.storageUrl

  /**
   * React reuses the `<video>` element across a client-side navigation, and
   * mutating a `<source>`'s `src` does not reload the media — the element
   * keeps the previously decoded stream until told otherwise. Without this,
   * navigating story → story leaves the first video in place.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the sources are the reload trigger
  useEffect(() => {
    videoRef.current?.load()
  }, [src, mobileSrc])

  if (video == null || src == null) return null

  const sourceCaption = video.caption as Record<string, any> | undefined
  const overrideCaption = block.caption as Record<string, any> | undefined
  const caption = block.useSourceVideoCaption ? sourceCaption : overrideCaption

  // `poster` takes one URL and cannot negotiate format, so this reads the
  // WebP `poster` variant, falling back to `card` and finally to the
  // original upload (`pickVariantUrl`'s last resort).
  const poster = pickVariantUrl(video.poster, 'poster', 'card')

  // Reserve the player's box before metadata arrives. The poster is required
  // to match the video's aspect ratio, so its dimensions are the right source.
  const aspectRatio =
    video.poster?.imageWidth != null && video.poster?.imageHeight != null
      ? `${video.poster.imageWidth} / ${video.poster.imageHeight}`
      : undefined

  const Comp = block.display === 'full_width' ? 'div' : Container

  return (
    <Comp
      id={id}
      className={cx(
        'px-0',
        {
          'lg:max-w-[920px] xl:max-w-[920px] 2xl:max-w-[920px] mx-auto':
            block.display === 'default',
        },
        className
      )}
    >
      <FadeInLift as="div" delay={0.25}>
        {/* The legacy collection has no timed-caption file to attach. Its localized
            editorial caption is rendered directly below the player. */}
        {/* biome-ignore lint/a11y/useMediaCaption: no timed-caption asset exists in the source data */}
        <video
          ref={videoRef}
          className={cx('video-block--video not-prose block h-auto w-full', {
            // Editorial full-bleed. Suppressed in a narrowed column — see the
            // note on `constrained` in `document-layout.tsx`.
            'block-full-bleed': block.display === 'full_width' && !constrainedLayout,
          })}
          controls
          playsInline
          preload="metadata"
          poster={poster}
          style={{ aspectRatio }}
          aria-label={video.alt}
        >
          {mobileSrc != null ? (
            <source src={mobileSrc} type={mobile?.file.mimeType} media="(max-width: 767px)" />
          ) : null}
          <source src={src} type={video.file.mimeType} />
        </video>
        {caption?.root?.children ? (
          <Container className={cx('py-2', 'px-0')}>
            <div className="video-block--caption [&_p]:m-0 muted text-[1rem]">
              <LexicalRichText lng={lng} nodes={caption.root.children} />
            </div>
          </Container>
        ) : null}
      </FadeInLift>
    </Comp>
  )
}
