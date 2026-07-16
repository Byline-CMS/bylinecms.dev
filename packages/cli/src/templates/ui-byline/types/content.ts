import type { WithPopulated } from '@byline/client'

import type { DocsFields, MediaFields, PagesFields } from '@byline/generated-types'

type ContentBlockOf<Fields extends { content?: unknown }> =
  NonNullable<Fields['content']> extends Array<infer Block> ? Block : never
type ContentBlock = ContentBlockOf<DocsFields> | ContentBlockOf<PagesFields>
type PhotoBlockData = Extract<ContentBlock, { _type: 'photoBlock' }>
type PopulatePhotoBlock<Block> = Block extends PhotoBlockData
  ? WithPopulated<Block, 'photo', MediaFields>
  : Block
type PopulatePhotoBlockContent<Content> =
  Content extends Array<infer Block> ? Array<PopulatePhotoBlock<Block>> : Content

/** Photo block shape returned by reads that populate the `photo` relation. */
export type PopulatedPhotoBlockData = WithPopulated<PhotoBlockData, 'photo', MediaFields>

export type PopulatedContentBlock = PopulatePhotoBlock<ContentBlock>

/** Overlay populated photo blocks while preserving each consumer's content union. */
export type WithPopulatedPhotoBlockContent<Fields> = {
  [Key in keyof Fields]: Key extends 'content'
    ? PopulatePhotoBlockContent<Fields[Key]>
    : Fields[Key]
}
