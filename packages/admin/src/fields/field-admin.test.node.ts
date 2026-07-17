/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { sliceFieldAdmin } from './field-admin.js'

describe('sliceFieldAdmin', () => {
  const answer = { editor: (() => null) as any }
  const question = { components: {} }

  it('returns undefined for an undefined map', () => {
    expect(sliceFieldAdmin(undefined, 'faq')).toBeUndefined()
  })

  it('returns undefined when no entry addresses a descendant of the child', () => {
    expect(sliceFieldAdmin({ faq: question, other: question }, 'faq')).toBeUndefined()
  })

  it('strips the child prefix from descendant keys', () => {
    expect(sliceFieldAdmin({ 'faq.answer': answer, 'faq.question': question }, 'faq')).toEqual({
      answer,
      question,
    })
  })

  it('keeps deeper paths dotted for the next level to slice', () => {
    const map = { 'files.filesGroup.publicationFile': question }
    const level1 = sliceFieldAdmin(map, 'files')
    expect(level1).toEqual({ 'filesGroup.publicationFile': question })
    expect(sliceFieldAdmin(level1, 'filesGroup')).toEqual({ publicationFile: question })
  })

  it('does not match on name prefixes that are not path segments', () => {
    // 'faqExtra.answer' must not be sliced by child 'faq'.
    expect(sliceFieldAdmin({ 'faqExtra.answer': answer }, 'faq')).toBeUndefined()
  })

  it('excludes the child’s own exact-name entry from the slice', () => {
    expect(sliceFieldAdmin({ faq: question, 'faq.answer': answer }, 'faq')).toEqual({
      answer,
    })
  })
})
