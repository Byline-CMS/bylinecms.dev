'use client'

import { Container } from '@infonomic/uikit/react'
import cx from 'classnames'

import type { RichTextBlockData } from '~/blocks/richtext-block'

import { LexicalRichText } from '@/ui/byline/components/richtext-lexical'
import type { Locale } from '@/i18n/i18n-config'

interface Props {
  id: string
  block: RichTextBlockData
  lng: Locale
  constrainedLayout?: boolean
  className?: string
}

export function RichTextBlock({
  id,
  block,
  lng,
  className,
  constrainedLayout,
}: Props): React.JSX.Element {
  // TODO: richText is a Lexical richText field — type properly once the
  // Lexical node shape is modelled in @byline/core.
  const content = block.richText as Record<string, any> | undefined
  const constrainedWidth = block.constrainedWidth

  return (
    <Container
      id={id}
      className={cx(
        'pt-4 bg-white dark:bg-canvas-900',
        { 'max-w-full sm:max-w-full lg:max-w-full xl:max-w-full': constrainedWidth === false },
        { 'px-0': constrainedLayout },
        className
      )}
    >
      <div className={cx('mx-auto', { 'max-w-[920px]': constrainedWidth === true })}>
        <LexicalRichText lng={lng} nodes={content?.root?.children} />
      </div>
    </Container>
  )
}
