import type { WithPopulated } from '@byline/client'

import type {
  MediaFields,
  PhotoBlockData,
  RichTextBlockData,
} from '~/generated/collection-types.js'

/** Photo block shape returned by reads that populate the `photo` relation. */
export type PopulatedPhotoBlockData = WithPopulated<PhotoBlockData, 'photo', MediaFields>

export type PopulatedContentBlock = RichTextBlockData | PopulatedPhotoBlockData
