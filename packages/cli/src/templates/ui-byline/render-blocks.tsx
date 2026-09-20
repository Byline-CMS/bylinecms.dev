import { Section } from '@byline/ui/react'

import { PhotoBlock } from '@/ui/byline/blocks/photo-block'
import { RichTextBlock } from '@/ui/byline/blocks/richtext-block'
import { toKebabCase } from '@/ui/byline/utils/to-kebab-case'
import type { PopulatedContentBlock } from '@/ui/byline/types/content'
import type { Locale } from '@/ui/byline/types/i18n'

interface Props {
  blocks: PopulatedContentBlock[] | undefined | null
  lng: Locale
  constrainedLayout?: boolean
}

interface BlockProps<Block> {
  id: string
  block: Block
  lng: Locale
  constrainedLayout?: boolean
}

/**
 * Registry of block renderers, keyed by `_type`.
 *
 * The mapped type is the point: it requires an entry for every member of the
 * `PopulatedContentBlock` union, so adding a block to a collection's `content`
 * field without writing a renderer fails to compile here rather than showing
 * up as a hole in a page. Each entry's `block` prop is narrowed to that
 * `_type`'s own shape, so a renderer cannot be registered under the wrong key.
 */
type BlockRegistry = {
  [Key in PopulatedContentBlock['_type']]: React.ComponentType<
    BlockProps<Extract<PopulatedContentBlock, { _type: Key }>>
  >
}

const blockComponents: BlockRegistry = {
  photoBlock: PhotoBlock,
  richTextBlock: RichTextBlock,
}

/**
 * Loose alias for the call site. `BlockRegistry` enforces correctness where
 * the components are registered; TypeScript cannot carry that correlation
 * through the map loop, and a per-block cast there would assert the same
 * thing less visibly.
 */
type AnyBlockComponent = React.ComponentType<BlockProps<any>>

export function RenderBlocks({
  blocks,
  constrainedLayout = false,
  lng,
}: Props): React.JSX.Element | null {
  if (!Array.isArray(blocks) || blocks.length === 0) return null

  return (
    <>
      {blocks.map((block) => {
        const Block = blockComponents[block._type] as AnyBlockComponent | undefined
        if (Block == null) return reportUnsupportedBlock(block)

        return (
          <Section className={toKebabCase(block._type)} key={block._id}>
            <Block id={block._id} block={block} lng={lng} constrainedLayout={constrainedLayout} />
          </Section>
        )
      })}
    </>
  )
}

/**
 * Compile-time exhaustiveness does not cover runtime data: a document written
 * before a block was removed, or by a newer deployment, can still carry a
 * `_type` this build has no renderer for. Report it and skip, rather than
 * failing the whole page.
 */
function reportUnsupportedBlock(block: PopulatedContentBlock): null {
  const type = (block as { _type?: unknown })._type
  console.error(`Unsupported content block type: "${String(type)}"`)
  return null
}
