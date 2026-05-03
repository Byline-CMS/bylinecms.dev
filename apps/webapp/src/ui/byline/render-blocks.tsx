import type { BlocksUnion } from '@byline/core'
import { Section } from '@infonomic/uikit/react'

import { PhotoBlock as PhotoBlockDef } from '~/blocks/photo-block'
import { RichTextBlock as RichTextBlockDef } from '~/blocks/richtext-block'

import { PhotoBlock } from '@/ui/byline/blocks/photo-block'
import { RichTextBlock } from '@/ui/byline/blocks/richtext-block'
import { toKebabCase } from '@/ui/utils/to-kebab-case'
import type { Locale } from '@/i18n/i18n-config'

/**
 * Registered block schemas. Add a new block here (and a matching `case`
 * in the switch below) to wire it into the front-end renderer.
 */
const Blocks = [PhotoBlockDef, RichTextBlockDef] as const

/**
 * Discriminated union of every registered block's instance shape. Use
 * this as the `blocks` prop type when calling `RenderBlocks`.
 */
export type AnyBlock = BlocksUnion<typeof Blocks>

interface Props {
  blocks: AnyBlock[] | undefined | null
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
        switch (block._type) {
          case 'photoBlock':
            return (
              <Section className={toKebabCase(block._type)} key={block._id}>
                <PhotoBlock
                  id={block._id}
                  block={block}
                  lng={lng}
                  constrainedLayout={constrainedLayout}
                />
              </Section>
            )
          case 'richTextBlock':
            return (
              <Section className={toKebabCase(block._type)} key={block._id}>
                <RichTextBlock
                  id={block._id}
                  block={block}
                  lng={lng}
                  constrainedLayout={constrainedLayout}
                />
              </Section>
            )
          default: {
            const _exhaustive: never = block
            return null
          }
        }
      })}
    </>
  )
}
