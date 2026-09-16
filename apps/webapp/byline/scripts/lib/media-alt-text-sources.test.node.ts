/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { describe, expect, test } from 'vitest'

import { collectAltTextSources } from './media-alt-text-sources.js'

/** Stand-in for the importer's filename-slug rule. */
const toMediaPath = (url: string) =>
  (url.split('/').pop() ?? url).replace(/\.[^.]+$/, '').toLowerCase()

describe('collectAltTextSources', () => {
  test('maps each image to the alt text its markdown gave it', () => {
    const { altByPath, conflicts } = collectAltTextSources(
      [{ file: 'a.md', body: '![A rack of servers.](./images/hosts.svg)\n' }],
      toMediaPath
    )
    expect(Object.fromEntries(altByPath)).toEqual({ hosts: 'A rack of servers.' })
    expect(conflicts).toEqual([])
  })

  test('accepts the same description repeated across files', () => {
    const { altByPath, conflicts } = collectAltTextSources(
      [
        { file: 'a.md', body: '![A rack of servers.](./images/hosts.svg)\n' },
        { file: 'b.md', body: '![A rack of servers.](../other/hosts.svg)\n' },
      ],
      toMediaPath
    )
    expect(altByPath.get('hosts')).toBe('A rack of servers.')
    expect(conflicts).toEqual([])
  })

  test('reports a slug described two different ways and supplies no value for it', () => {
    // One media document cannot take two descriptions, and picking by scan
    // order would make the repair depend on filesystem enumeration. Report it
    // and leave the record for a person.
    const { altByPath, conflicts } = collectAltTextSources(
      [
        { file: 'b.md', body: '![Second description.](./images/hosts.svg)\n' },
        { file: 'a.md', body: '![First description.](./images/hosts.svg)\n' },
      ],
      toMediaPath
    )
    expect(altByPath.has('hosts')).toBe(false)
    expect(conflicts).toEqual([
      {
        mediaPath: 'hosts',
        candidates: [
          { file: 'a.md', alt: 'First description.' },
          { file: 'b.md', alt: 'Second description.' },
        ],
      },
    ])
  })

  test('reports two descriptions of the same URL inside one file', () => {
    // `collectImages` collapses repeats of a URL for ingestion, which is right
    // for deciding what to upload and wrong for deciding what to write: the
    // second description would never be compared, and whichever occurrence came
    // first would silently win.
    const { altByPath, conflicts } = collectAltTextSources(
      [
        {
          file: 'a.md',
          body: '![First description.](./hosts.svg)\n\n![Second description.](./hosts.svg)\n',
        },
      ],
      toMediaPath
    )
    expect(altByPath.has('hosts')).toBe(false)
    expect(conflicts).toEqual([
      {
        mediaPath: 'hosts',
        candidates: [
          { file: 'a.md', alt: 'First description.' },
          { file: 'a.md', alt: 'Second description.' },
        ],
      },
    ])
  })

  test('is independent of occurrence order inside one file', () => {
    const forward = collectAltTextSources(
      [{ file: 'a.md', body: '![First.](./hosts.svg)\n\n![Second.](./hosts.svg)\n' }],
      toMediaPath
    )
    const reversed = collectAltTextSources(
      [{ file: 'a.md', body: '![Second.](./hosts.svg)\n\n![First.](./hosts.svg)\n' }],
      toMediaPath
    )
    expect(forward).toEqual(reversed)
  })

  test('accepts one description repeated within a file', () => {
    const { altByPath, conflicts } = collectAltTextSources(
      [{ file: 'a.md', body: '![A rack.](./hosts.svg)\n\n![A rack.](./hosts.svg)\n' }],
      toMediaPath
    )
    expect(altByPath.get('hosts')).toBe('A rack.')
    expect(conflicts).toEqual([])
  })

  test('ignores images whose markdown carries no alt text', () => {
    const { altByPath, conflicts } = collectAltTextSources(
      [{ file: 'a.md', body: '![](./images/hosts.svg)\n\n![   ](./images/other.svg)\n' }],
      toMediaPath
    )
    expect(altByPath.size).toBe(0)
    expect(conflicts).toEqual([])
  })

  test('is independent of the order files are supplied in', () => {
    const documents = [
      { file: 'b.md', body: '![Beta.](./b.svg)\n' },
      { file: 'a.md', body: '![Alpha.](./a.svg)\n' },
    ]
    const forward = collectAltTextSources(documents, toMediaPath)
    const reversed = collectAltTextSources([...documents].reverse(), toMediaPath)
    expect([...forward.altByPath]).toEqual([...reversed.altByPath])
  })
})
