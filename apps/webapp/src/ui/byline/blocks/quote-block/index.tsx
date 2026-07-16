'use client'

import type { QuoteBlockData } from '@byline/generated-types'
import { Container } from '@byline/ui/react'
import cx from 'classnames'

import { LexicalRichText } from '@/ui/byline/components/richtext-lexical'
import type { Locale } from '@/i18n/i18n-config'

interface Props {
  id: string
  block: QuoteBlockData
  lng: Locale
  constrainedLayout?: boolean
  className?: string
}

export function QuoteBlock({
  id,
  block,
  lng,
  className,
  constrainedLayout,
}: Props): React.JSX.Element {
  // TODO: quoteText is a Lexical richText field — type properly once the
  // Lexical node shape is modelled in @byline/core.
  const content = block.quoteText as Record<string, any> | undefined

  return (
    <Container id={id} className={cx({ 'px-0': constrainedLayout }, className)}>
      <figure className="mx-auto max-w-[920px] border-l-4 border-theme-500 pl-6 py-2">
        {block.highlightQuote && (
          <p className="text-xl font-semibold mb-2">{block.highlightQuote}</p>
        )}
        <blockquote className="italic">
          <LexicalRichText lng={lng} nodes={content?.root?.children} />
        </blockquote>
        {block.source && (
          <figcaption className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            — {block.source}
          </figcaption>
        )}
      </figure>
    </Container>
  )
}
