import { Section } from '@byline/ui/react'
import cx from 'clsx'

import { CodeBlock } from '@/ui/byline/blocks/code-block'
import { FAQBlock } from '@/ui/byline/blocks/faq-block'
import { PhotoBlock } from '@/ui/byline/blocks/photo-block'
import { QuoteBlock } from '@/ui/byline/blocks/quote-block'
import { RichTextBlock } from '@/ui/byline/blocks/richtext-block'
import { VideoBlock } from '@/ui/byline/blocks/video-block'
import { VideoEmbedBlock } from '@/ui/byline/blocks/video-embed-block'
import { toKebabCase } from '@/ui/utils/to-kebab-case'
import type { Locale } from '@/i18n/i18n-config'
import type { PopulatedContentBlock } from '@/lib/content-types'

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
  codeBlock: CodeBlock,
  quoteBlock: QuoteBlock,
  faqBlock: FAQBlock,
  videoBlock: VideoBlock,
  videoEmbedBlock: VideoEmbedBlock,
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
        // Compile-time exhaustiveness does not cover runtime data: a document
        // written before a block was removed, or by a newer deployment, can
        // still carry a `_type` this build has no renderer for. Report it and
        // skip, rather than failing the whole page.
        const Block = blockComponents[block._type] as AnyBlockComponent | undefined
        if (Block == null) {
          console.error(`Unsupported content block type: "${String(block._type)}"`)
          return null
        }

        return (
          // `content-block` carries the vertical rhythm between blocks — see
          // `styles/blocks/rhythm.css`. It lives here rather than in each
          // block so every block, including ones added later, is spaced the
          // same way and no block can forget.
          <Section className={cx('content-block', toKebabCase(block._type))} key={block._id}>
            <Block id={block._id} block={block} lng={lng} constrainedLayout={constrainedLayout} />
          </Section>
        )
      })}
    </>
  )
}
