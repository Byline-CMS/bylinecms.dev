/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, it } from 'vitest'

import { resolveUploadFilename, slugifyFilename } from './slugify-filename.js'

const ctx = { collectionPath: 'events', fieldName: 'attachment', mimeType: 'application/pdf' }

describe('slugifyFilename (default)', () => {
  it('lowercases and hyphenates unsafe characters', () => {
    expect(slugifyFilename('Meeting Agenda (Final)', ctx)).toBe('meeting-agenda-final')
  })

  it('collapses hyphen runs and trims leading/trailing hyphens', () => {
    expect(slugifyFilename('--Board -- Notes--', ctx)).toBe('board-notes')
  })

  it('falls back to "file" for empty results', () => {
    expect(slugifyFilename('***', ctx)).toBe('file')
  })
})

describe('resolveUploadFilename', () => {
  it('slugifies the base name and lowercases the extension', () => {
    expect(resolveUploadFilename('Meeting Agenda.PDF', undefined, ctx)).toBe('meeting-agenda.pdf')
  })

  it('handles filenames without an extension', () => {
    expect(resolveUploadFilename('README', undefined, ctx)).toBe('readme')
  })

  it('treats a leading dot as part of the base name, not an extension', () => {
    expect(resolveUploadFilename('.gitignore', undefined, ctx)).toBe('.gitignore')
  })

  it('only splits at the last dot', () => {
    expect(resolveUploadFilename('archive.tar.gz', undefined, ctx)).toBe('archive.tar.gz')
  })

  it('applies a custom slugifier to the base name only', () => {
    const shouty = (base: string) => base.toUpperCase().replace(/[^A-Z0-9]/g, '_')
    expect(resolveUploadFilename('Meeting Agenda.pdf', shouty, ctx)).toBe('MEETING_AGENDA.pdf')
  })

  it('passes the slugify context through to the custom slugifier', () => {
    const seen: unknown[] = []
    resolveUploadFilename(
      'photo.jpg',
      (base, c) => {
        seen.push(c)
        return base
      },
      ctx
    )
    expect(seen).toEqual([ctx])
  })

  it('guards against a custom slugifier returning an empty string', () => {
    expect(resolveUploadFilename('photo.jpg', () => '', ctx)).toBe('file.jpg')
  })
})
