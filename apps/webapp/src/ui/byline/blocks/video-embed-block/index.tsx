'use client'

import type { VideoEmbedBlockData } from '@byline/generated-types'
import { Container, FadeInLift } from '@byline/ui/react'
import cx from 'clsx'

import { parseVideoEmbedId, videoEmbedSrc } from '@/lib/video-embed-url'
import { LexicalRichText } from '@/ui/byline/components/richtext-lexical'
import type { Locale } from '@/i18n/i18n-config'

interface Props {
  id: string
  block: VideoEmbedBlockData
  lng: Locale
  constrainedLayout?: boolean
  className?: string
}

/**
 * Third-party video embed (YouTube / Vimeo). Carries no relation, so unlike
 * `VideoBlock` it needs no populated read — the block's own `url` is the
 * whole payload. Layout matches `PhotoBlock` / `VideoBlock`.
 *
 * A URL that does not parse renders nothing rather than an empty player
 * frame; the admin preview is where a bad URL is meant to be caught.
 */
export function VideoEmbedBlock({
  id,
  block,
  lng,
  className,
  constrainedLayout,
}: Props): React.JSX.Element | null {
  const provider = block.type
  const videoID = parseVideoEmbedId(provider, block.url)
  if (videoID == null) return null

  const caption = block.caption as Record<string, any> | undefined
  const Comp = block.position === 'full_width' ? 'div' : Container

  return (
    <Comp
      id={id}
      className={cx(
        'px-0',
        {
          'lg:max-w-[920px] xl:max-w-[920px] 2xl:max-w-[920px] mx-auto':
            block.position === 'default',
        },
        className
      )}
    >
      <FadeInLift as="div" delay={0.25}>
        <iframe
          className={cx('video-embed-block--player not-prose block w-full', {
            'block-full-bleed': block.position === 'full_width' && !constrainedLayout,
          })}
          style={{ aspectRatio: '16 / 9' }}
          src={videoEmbedSrc(provider, videoID)}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title={provider === 'vimeo' ? 'Vimeo Video' : 'YouTube Video'}
        />
        {caption?.root?.children ? (
          <Container className={cx('py-2', 'px-0')}>
            <div className="video-embed-block--caption [&_p]:m-0 muted text-[1rem]">
              <LexicalRichText lng={lng} nodes={caption.root.children} />
            </div>
          </Container>
        ) : null}
      </FadeInLift>
    </Comp>
  )
}
