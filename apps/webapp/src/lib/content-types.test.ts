import type { WithPopulated } from '@byline/client'
import type { DocsFields, MediaFields, PagesFields } from '@byline/generated-types'
import { describe, expectTypeOf, it } from 'vitest'

import type { PopulatedContentBlock, WithPopulatedPhotoBlockContent } from './content-types'

type DocsContentBlock = NonNullable<DocsFields['content']>[number]
type PagesContentBlock = NonNullable<PagesFields['content']>[number]
type ConsumerContentBlock = DocsContentBlock | PagesContentBlock
type PhotoBlock = Extract<ConsumerContentBlock, { _type: 'photoBlock' }>
type ExpectedContentBlock =
  | Exclude<ConsumerContentBlock, PhotoBlock>
  | WithPopulated<PhotoBlock, 'photo', MediaFields>

type PagesOnlyBlock = {
  _id: string
  _type: 'pagesOnlyBlock'
  heading: string
}
type PagesWithAdditionalBlock = Omit<PagesFields, 'content'> & {
  content?: Array<PagesContentBlock | PagesOnlyBlock>
}
type PopulatedPagesBlock = NonNullable<
  WithPopulatedPhotoBlockContent<PagesWithAdditionalBlock>['content']
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
