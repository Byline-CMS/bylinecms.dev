import { Section } from '@byline/ui/react'

import { PhotoBlock } from '@/ui/byline/blocks/photo-block'
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
        return (
          <Section className={toKebabCase(block._type)} key={block._id}>
            {block._type === 'photoBlock' ? (
              <PhotoBlock
                id={block._id}
                block={block}
                lng={lng}
                constrainedLayout={constrainedLayout}
              />
            ) : (
              <RichTextBlock
                id={block._id}
                block={block}
                lng={lng}
                constrainedLayout={constrainedLayout}
              />
            )}
          </Section>
        )
      })}
    </>
  )
}
