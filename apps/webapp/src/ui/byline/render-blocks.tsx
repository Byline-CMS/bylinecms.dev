import { Section } from '@byline/ui/react'

import { CodeBlock } from '@/ui/byline/blocks/code-block'
import { PhotoBlock } from '@/ui/byline/blocks/photo-block'
import { QuoteBlock } from '@/ui/byline/blocks/quote-block'
import { RichTextBlock } from '@/ui/byline/blocks/richtext-block'
import { toKebabCase } from '@/ui/utils/to-kebab-case'
import type { Locale } from '@/i18n/i18n-config'
import type { PopulatedContentBlock } from '@/lib/content-types'

interface Props {
  blocks: PopulatedContentBlock[] | undefined | null
  lng: Locale
  constrainedLayout?: boolean
}

export function RenderBlocks({
  blocks,
  constrainedLayout = false,
  lng,
}: Props): React.JSX.Element | null {
  if (!Array.isArray(blocks) || blocks.length === 0) return null

  return (
    <>
      {blocks.map((block) => {
        const content = renderBlock(block, lng, constrainedLayout)
        if (content == null) return null

        return (
          <Section className={toKebabCase(block._type)} key={block._id}>
            {content}
          </Section>
        )
      })}
    </>
  )
}

function renderBlock(
  block: PopulatedContentBlock,
  lng: Locale,
  constrainedLayout: boolean
): React.JSX.Element | null {
  switch (block._type) {
    case 'photoBlock':
      return (
        <PhotoBlock id={block._id} block={block} lng={lng} constrainedLayout={constrainedLayout} />
      )
    case 'richTextBlock':
      return (
        <RichTextBlock
          id={block._id}
          block={block}
          lng={lng}
          constrainedLayout={constrainedLayout}
        />
      )
    case 'codeBlock':
      return (
        <CodeBlock id={block._id} block={block} lng={lng} constrainedLayout={constrainedLayout} />
      )
    case 'quoteBlock':
      return (
        <QuoteBlock id={block._id} block={block} lng={lng} constrainedLayout={constrainedLayout} />
      )
    default:
      return reportUnsupportedBlock(block)
  }
}

function reportUnsupportedBlock(block: never): null {
  const type = (block as { _type?: unknown })._type
  console.error(`Unsupported content block type: "${String(type)}"`)
  return null
}
