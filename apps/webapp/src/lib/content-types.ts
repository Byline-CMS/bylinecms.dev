import type { WithPopulated } from '@byline/client'

import type {
  MediaFields,
  PhotoBlockData,
  RichTextBlockData,
} from '~/generated/collection-types.js'

/** Block shape returned by reads that populate photo relations inside content. */
export type PopulatedPhotoBlockData = WithPopulated<PhotoBlockData, 'photo', MediaFields>

export type PopulatedContentBlock = RichTextBlockData | PopulatedPhotoBlockData

/** Overlay the populated content-block union while preserving field optionality. */
export type WithPopulatedPhotoBlockContent<Fields> = {
  [Key in keyof Fields]: Key extends 'content' ? PopulatedContentBlock[] | undefined : Fields[Key]
}
