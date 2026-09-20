import type { WithPopulated } from '@byline/client'
import type { DocsFields, MediaFields, PagesFields, VideosFields } from '@byline/generated-types'
import { describe, expectTypeOf, it } from 'vitest'

import type { PopulatedContentBlock, WithPopulatedBlockContent } from './content-types'

type DocsContentBlock = NonNullable<DocsFields['content']>[number]
type PagesContentBlock = NonNullable<PagesFields['content']>[number]
type ConsumerContentBlock = DocsContentBlock | PagesContentBlock
type PhotoBlock = Extract<ConsumerContentBlock, { _type: 'photoBlock' }>
type VideoBlock = Extract<ConsumerContentBlock, { _type: 'videoBlock' }>
type ExpectedContentBlock =
  | Exclude<ConsumerContentBlock, PhotoBlock | VideoBlock>
  | WithPopulated<PhotoBlock, 'photo', MediaFields>
  | WithPopulated<WithPopulated<VideoBlock, 'video', VideosFields>, 'videoMobile', VideosFields>

type PagesOnlyBlock = {
  _id: string
  _type: 'pagesOnlyBlock'
  heading: string
}
type PagesWithAdditionalBlock = Omit<PagesFields, 'content'> & {
  content?: Array<PagesContentBlock | PagesOnlyBlock>
}
type PopulatedPagesBlock = NonNullable<
  WithPopulatedBlockContent<PagesWithAdditionalBlock>['content']
>[number]

describe('content types', () => {
  it('covers the combined Docs and Pages content unions', () => {
    expectTypeOf<PopulatedContentBlock>().toEqualTypeOf<ExpectedContentBlock>()
  })

  it('preserves consumer-specific blocks in the generic overlay', () => {
    expectTypeOf<
      Extract<PopulatedPagesBlock, { _type: 'pagesOnlyBlock' }>
    >().toEqualTypeOf<PagesOnlyBlock>()
  })
})
