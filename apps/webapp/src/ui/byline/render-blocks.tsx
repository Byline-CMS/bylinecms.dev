import type { BlocksUnion } from '@byline/core'
import { Section } from '@byline/ui/react'

import { PhotoBlock as PhotoBlockDef } from '~/blocks/photo-block'
import { RichTextBlock as RichTextBlockDef } from '~/blocks/richtext-block'

import { PhotoBlock } from '@/ui/byline/blocks/photo-block'
import { RichTextBlock } from '@/ui/byline/blocks/richtext-block'
import { toKebabCase } from '@/ui/utils/to-kebab-case'
import type { Locale } from '@/i18n/i18n-config'

const Blocks = [PhotoBlockDef, RichTextBlockDef] as const

export type AnyBlock = BlocksUnion<typeof Blocks>

// Mapped type ensures every AnyBlock['_type'] has a registered component.
// TypeScript errors here if Blocks gains a new type without a matching entry.
type BlockRegistry = {
  [K in AnyBlock['_type']]: React.ComponentType<{
    id: string
    block: Extract<AnyBlock, { _type: K }>
    lng: Locale
    constrainedLayout?: boolean
  }>
}

const blockComponents: BlockRegistry = {
  photoBlock: PhotoBlock,
  richTextBlock: RichTextBlock,
}

// Loose alias for the call site — BlockRegistry enforces correctness at
// definition time; TypeScript can't infer the correlation during the map loop.
type AnyBlockComponent = React.ComponentType<{
  id: string
  block: AnyBlock
  lng: Locale
  constrainedLayout?: boolean
}>

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
        const Block = blockComponents[block._type] as AnyBlockComponent
        return (
          <Section className={toKebabCase(block._type)} key={block._id}>
            <Block id={block._id} block={block} lng={lng} constrainedLayout={constrainedLayout} />
          </Section>
        )
      })}
    </>
  )
}
