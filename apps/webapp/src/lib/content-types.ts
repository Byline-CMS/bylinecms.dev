import type { WithPopulated } from '@byline/client'
import type { DocsFields, MediaFields, PagesFields, VideosFields } from '@byline/generated-types'

type ContentBlockOf<Fields extends { content?: unknown }> =
  NonNullable<Fields['content']> extends Array<infer Block> ? Block : never
type ContentBlock = ContentBlockOf<DocsFields> | ContentBlockOf<PagesFields>

type PhotoBlockData = Extract<ContentBlock, { _type: 'photoBlock' }>
type VideoBlockData = Extract<ContentBlock, { _type: 'videoBlock' }>

/**
 * Overlay every relation a content block can hold. A block's relation is only
 * resolved when the read's populate map names it, so this mirrors the populate
 * maps in the detail loaders: keep the two in step or a block renders with an
 * unresolved envelope.
 */
type PopulateBlockRelations<Block> = Block extends PhotoBlockData
  ? WithPopulated<Block, 'photo', MediaFields>
  : Block extends VideoBlockData
    ? WithPopulated<WithPopulated<Block, 'video', VideosFields>, 'videoMobile', VideosFields>
    : Block

type PopulateBlockContent<Content> =
  Content extends Array<infer Block> ? Array<PopulateBlockRelations<Block>> : Content

/** Block shape returned by reads that populate photo relations inside content. */
export type PopulatedPhotoBlockData = WithPopulated<PhotoBlockData, 'photo', MediaFields>

/** Block shape returned by reads that populate video relations inside content. */
export type PopulatedVideoBlockData = WithPopulated<
  WithPopulated<VideoBlockData, 'video', VideosFields>,
  'videoMobile',
  VideosFields
>

export type PopulatedContentBlock = PopulateBlockRelations<ContentBlock>

/** Overlay the populated content-block union while preserving field optionality. */
export type WithPopulatedBlockContent<Fields> = {
  [Key in keyof Fields]: Key extends 'content' ? PopulateBlockContent<Fields[Key]> : Fields[Key]
}
