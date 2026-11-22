/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { SerializedEditorState } from 'lexical'
import { describe, expect, it } from 'vitest'

import { contentFingerprint } from './content-fingerprint'

// The unchanged-content rule for rich-text caret replay: after a save, the
// caret is replayed only when the reloaded content has the same fingerprint
// as the content that was saved. Only metadata the save path itself
// refreshes on embeds may differ.

type Json = any

const text = (value: string) => ({
  detail: 0,
  format: 0,
  mode: 'normal',
  style: '',
  text: value,
  type: 'text',
  version: 1,
})
const block = (type: string, children: unknown[], extra: Record<string, unknown> = {}) => ({
  children,
  direction: null,
  format: '',
  indent: 0,
  type,
  version: 1,
  ...extra,
})
const content = (...children: unknown[]): Json => ({
  root: { children, direction: null, format: '', indent: 0, type: 'root', version: 1 },
})
const paragraph = (value: string) => block('paragraph', [text(value)])

const internalLink = (label: string) =>
  block('link', [text(label)], {
    version: 2,
    attributes: {
      linkType: 'internal',
      targetDocumentId: 'page-1',
      targetCollectionId: 'pages-id',
      targetCollectionPath: 'pages',
      document: { title: 'A page', path: '/pages/a-page' },
    },
  })
const customLink = (label: string, url: string) =>
  block('link', [text(label)], { version: 2, attributes: { linkType: 'custom', url } })
const embedImage = () =>
  block('paragraph', [
    {
      type: 'inline-image',
      version: 1,
      targetDocumentId: 'media-1',
      targetCollectionId: 'media-id',
      targetCollectionPath: 'media',
      document: {
        title: 'Cat',
        altText: 'a cat',
        image: { storageUrl: '/cat.png' },
        focalPoint: 'center',
      },
      src: '/cat.png',
      position: 'full',
      altText: 'an authored cat',
      width: 10,
      height: 10,
      showCaption: true,
      caption: { editorState: content(paragraph('A cat')) },
      link: {
        linkType: 'internal',
        targetDocumentId: 'page-2',
        targetCollectionId: 'pages-id',
        targetCollectionPath: 'pages',
        document: { title: 'Another page', path: '/pages/another' },
      },
    },
  ])
const saved = (): Json =>
  content(
    block('paragraph', [
      text('HelloQ world '),
      internalLink('inside'),
      text(' and '),
      customLink('outside', 'https://example.com/a'),
    ]),
    embedImage()
  )

/** Every node reachable through `children`, depth first. */
function* nodesOf(node: Json): Generator<Json> {
  yield node
  for (const child of node.children ?? []) yield* nodesOf(child)
}
const findNode = (state: Json, predicate: (node: Json) => boolean): Json => {
  const found = [...nodesOf(state.root)].find(predicate)
  if (found == null) throw new Error('fixture node not found')
  return found
}
const imageOf = (state: Json) => findNode(state, (node) => node.type === 'inline-image')
const linkOf = (state: Json, linkType: string) =>
  findNode(state, (node) => node.type === 'link' && node.attributes?.linkType === linkType)

/** The fingerprint of a copy of the saved fixture after `serverCopy` changes it. */
const reloaded = (serverCopy: (state: Json) => void) => {
  const state = saved()
  serverCopy(state)
  return contentFingerprint(state as SerializedEditorState)
}

describe('contentFingerprint', () => {
  const original = contentFingerprint(saved() as SerializedEditorState)

  it.each([
    ['plain unchanged content', () => {}],
    [
      'the same embeds with only server-refreshed metadata',
      (state: Json) => {
        const image = imageOf(state)
        image.src = '/media/cat-tablet.webp'
        image.width = 768
        image.height = 512
        image.document = {
          ...image.document,
          title: 'Cat, renamed',
          altText: 'a cat, refreshed',
          image: { storageUrl: '/media/cat.webp' },
          sizes: [{ name: 'tablet', url: '/media/cat-tablet.webp' }],
          _resolved: true,
        }
        image.link.document = { title: 'Another page, renamed', path: '/pages/moved' }
        linkOf(state, 'internal').attributes.document = {
          title: 'A page, renamed',
          path: '/pages/renamed',
        }
      },
    ],
  ])('%s: the fingerprint matches, so the caret is replayed', (_name, serverCopy) => {
    expect(reloaded(serverCopy)).toBe(original)
  })

  it.each([
    [
      'a text change',
      (state: Json) => {
        findNode(state, (node) => node.type === 'text').text = 'Hello world '
      },
    ],
    [
      'a link URL change',
      (state: Json) => {
        linkOf(state, 'custom').attributes.url = 'https://example.com/b'
      },
    ],
    [
      'an internal link to a different document',
      (state: Json) => {
        linkOf(state, 'internal').attributes.targetDocumentId = 'page-9'
      },
    ],
    [
      'a swapped image (a different media document)',
      (state: Json) => {
        const image = imageOf(state)
        image.targetDocumentId = 'media-2'
        image.src = '/dog.png'
      },
    ],
    [
      'a formatting change (bold toggled)',
      (state: Json) => {
        findNode(state, (node) => node.type === 'text').format = 1
      },
    ],
    [
      'a changed caption',
      (state: Json) => {
        imageOf(state).caption.editorState.root.children[0].children[0].text = 'A dog'
      },
    ],
    [
      'an attribute the rule does not know about',
      (state: Json) => {
        imageOf(state).document.focalPoint = 'top'
      },
    ],
    [
      'an authored alt text change',
      (state: Json) => {
        imageOf(state).altText = 'an authored dog'
      },
    ],
  ])('%s: the fingerprint differs, so no caret is replayed', (_name, serverCopy) => {
    expect(reloaded(serverCopy)).not.toBe(original)
  })

  it('does not modify the state it fingerprints', () => {
    const state = saved()
    const before = JSON.stringify(state)
    contentFingerprint(state as SerializedEditorState)
    expect(JSON.stringify(state)).toBe(before)
  })
})
