/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Serialization coverage for the inline image's optional click-through
 * link.
 *
 * The JSON round-trip is the load-bearing one: copying an inline image in
 * the editor and pasting it elsewhere goes through
 * `application/x-lexical-editor` (priority 0, ahead of `text/html` at 10 —
 * see `@lexical/clipboard`'s `DEFAULT_IMPORT_MIME_TYPE_PRIORITY`), which is
 * `exportJSON` → `importJSON`, NOT `exportDOM` / `importDOM`. So the link
 * surviving `exportJSON`/`importJSON` is what makes copy-paste keep it.
 *
 * The DOM round-trip is the secondary path — pasting out to a non-Lexical
 * target and back, or between editors whose namespaces differ. It encodes
 * the relation on the `<img>` as `data-link-*` attributes rather than
 * wrapping in an `<a>`, because an `<a>` would make Lexical's own link
 * conversion produce a link node wrapping an inline-image node on import.
 */

import { createEditor, type LexicalEditor } from 'lexical'
import { describe, expect, it } from 'vitest'

import { $createInlineImageNode, $isInlineImageNode, InlineImageNode } from './inline-image-node'
import type { LinkAttributes } from '../link'
import type { InlineImageAttributes, SerializedInlineImageNode } from './node-types'

function editorWithImageNode(): LexicalEditor {
  return createEditor({
    namespace: 'test',
    nodes: [InlineImageNode],
    onError: (e) => {
      throw e
    },
  })
}

const baseAttributes: InlineImageAttributes = {
  targetDocumentId: 'media-1',
  targetCollectionId: 'coll-media',
  targetCollectionPath: 'media',
  src: 'https://cdn.example.com/media/shot-card.avif',
  altText: 'A photograph of a heron',
  position: 'left',
  width: 600,
  height: 450,
  showCaption: false,
}

const internalLink: LinkAttributes = {
  linkType: 'internal',
  newTab: false,
  targetDocumentId: 'doc-1',
  targetCollectionId: 'coll-pages',
  targetCollectionPath: 'pages',
  document: { title: 'About Us', path: '/pages/about' },
}

const customLink: LinkAttributes = {
  linkType: 'custom',
  url: 'https://example.com/report',
  newTab: true,
}

/** Serialize a node built from `attributes`, then parse it back. */
function jsonRoundTrip(attributes: InlineImageAttributes): SerializedInlineImageNode {
  const editor = editorWithImageNode()
  let serialized: SerializedInlineImageNode | undefined
  editor.update(
    () => {
      const exported = $createInlineImageNode(attributes).exportJSON()
      const reimported = InlineImageNode.importJSON(exported)
      serialized = reimported.exportJSON()
    },
    { discrete: true }
  )
  if (serialized == null) throw new Error('round-trip produced nothing')
  return serialized
}

describe('InlineImageNode link serialization', () => {
  describe('exportJSON', () => {
    it('omits link entirely when the image has no click target', () => {
      const editor = editorWithImageNode()
      let out: SerializedInlineImageNode | undefined
      editor.update(
        () => {
          out = $createInlineImageNode(baseAttributes).exportJSON()
        },
        { discrete: true }
      )
      expect(out?.link).toBeUndefined()
    })

    it('carries an internal link', () => {
      const editor = editorWithImageNode()
      let out: SerializedInlineImageNode | undefined
      editor.update(
        () => {
          out = $createInlineImageNode({ ...baseAttributes, link: internalLink }).exportJSON()
        },
        { discrete: true }
      )
      expect(out?.link).toEqual(internalLink)
    })
  })

  describe('JSON round-trip (the copy-paste path)', () => {
    it('preserves an internal link', () => {
      expect(jsonRoundTrip({ ...baseAttributes, link: internalLink }).link).toEqual(internalLink)
    })

    it('preserves a custom URL link with its newTab flag', () => {
      expect(jsonRoundTrip({ ...baseAttributes, link: customLink }).link).toEqual(customLink)
    })

    it('leaves an unlinked image unlinked', () => {
      expect(jsonRoundTrip(baseAttributes).link).toBeUndefined()
    })

    it('keeps the media relation and the link relation distinct', () => {
      const out = jsonRoundTrip({ ...baseAttributes, link: internalLink })
      expect(out.targetDocumentId).toBe('media-1')
      expect(out.targetCollectionPath).toBe('media')
      expect(out.link?.linkType === 'internal' && out.link.targetDocumentId).toBe('doc-1')
    })

    // Nodes written before this feature have no `link` key at all; they
    // must import without complaint and stay unlinked.
    it('imports a pre-feature node that has no link key', () => {
      const editor = editorWithImageNode()
      let node: InlineImageNode | undefined
      editor.update(
        () => {
          const legacy = { ...baseAttributes, type: 'inline-image', version: 1 } as any
          delete legacy.link
          legacy.caption = { editorState: { root: { children: [], type: 'root', version: 1 } } }
          node = InlineImageNode.importJSON(legacy)
        },
        { discrete: true }
      )
      expect(node && $isInlineImageNode(node)).toBe(true)
      expect(node?.getLink()).toBeUndefined()
    })
  })

  describe('update()', () => {
    it('sets a link on an image that had none', () => {
      const editor = editorWithImageNode()
      let link: LinkAttributes | undefined
      editor.update(
        () => {
          const node = $createInlineImageNode(baseAttributes)
          node.update({ ...baseAttributes, link: internalLink })
          link = node.getLink()
        },
        { discrete: true }
      )
      expect(link).toEqual(internalLink)
    })

    it('replaces an existing link', () => {
      const editor = editorWithImageNode()
      let link: LinkAttributes | undefined
      editor.update(
        () => {
          const node = $createInlineImageNode({ ...baseAttributes, link: internalLink })
          node.update({ ...baseAttributes, link: customLink })
          link = node.getLink()
        },
        { discrete: true }
      )
      expect(link).toEqual(customLink)
    })

    // The rest of `update()` uses `!= null` guards, so an explicit
    // undefined would be a silent no-op. Removing a link has to work.
    it('clears the link when the key is present and undefined', () => {
      const editor = editorWithImageNode()
      let link: LinkAttributes | undefined = internalLink
      editor.update(
        () => {
          const node = $createInlineImageNode({ ...baseAttributes, link: internalLink })
          node.update({ ...baseAttributes, link: undefined })
          link = node.getLink()
        },
        { discrete: true }
      )
      expect(link).toBeUndefined()
    })

    it('leaves the link untouched when the key is absent', () => {
      const editor = editorWithImageNode()
      let link: LinkAttributes | undefined
      editor.update(
        () => {
          const node = $createInlineImageNode({ ...baseAttributes, link: internalLink })
          node.update({ altText: 'Changed alt' } as InlineImageAttributes)
          link = node.getLink()
        },
        { discrete: true }
      )
      expect(link).toEqual(internalLink)
    })
  })

  describe('DOM round-trip', () => {
    it('encodes a custom link as data attributes without wrapping in an anchor', () => {
      const editor = editorWithImageNode()
      let element: HTMLElement | undefined
      editor.update(
        () => {
          element = $createInlineImageNode({ ...baseAttributes, link: customLink }).exportDOM()
            .element as HTMLElement
        },
        { discrete: true }
      )
      expect(element?.tagName).toBe('IMG')
      expect(element?.getAttribute('data-link-type')).toBe('custom')
      expect(element?.getAttribute('data-link-url')).toBe('https://example.com/report')
      expect(element?.getAttribute('data-link-new-tab')).toBe('true')
    })

    it('encodes an internal link relation as data attributes', () => {
      const editor = editorWithImageNode()
      let element: HTMLElement | undefined
      editor.update(
        () => {
          element = $createInlineImageNode({ ...baseAttributes, link: internalLink }).exportDOM()
            .element as HTMLElement
        },
        { discrete: true }
      )
      expect(element?.getAttribute('data-link-type')).toBe('internal')
      expect(element?.getAttribute('data-link-target-document-id')).toBe('doc-1')
      expect(element?.getAttribute('data-link-target-collection-id')).toBe('coll-pages')
      expect(element?.getAttribute('data-link-target-collection-path')).toBe('pages')
    })

    it('emits no link attributes for an unlinked image', () => {
      const editor = editorWithImageNode()
      let element: HTMLElement | undefined
      editor.update(
        () => {
          element = $createInlineImageNode(baseAttributes).exportDOM().element as HTMLElement
        },
        { discrete: true }
      )
      expect(element?.hasAttribute('data-link-type')).toBe(false)
    })

    it('reads a custom link back off the data attributes', () => {
      const editor = editorWithImageNode()
      const img = document.createElement('img')
      img.setAttribute('src', baseAttributes.src)
      img.setAttribute('alt', 'A photograph of a heron')
      img.setAttribute('data-id', 'media-1')
      img.setAttribute('data-collection', 'media')
      img.setAttribute('data-link-type', 'custom')
      img.setAttribute('data-link-url', 'https://example.com/report')
      img.setAttribute('data-link-new-tab', 'true')

      let link: LinkAttributes | undefined
      editor.update(
        () => {
          const conversion = InlineImageNode.importDOM()?.img?.(img)
          const output = conversion?.conversion(img)
          const node = output?.node
          link = $isInlineImageNode(node) ? node.getLink() : undefined
        },
        { discrete: true }
      )
      expect(link).toEqual({ linkType: 'custom', url: 'https://example.com/report', newTab: true })
    })

    // The denormalised `{ title, path }` bag is deliberately NOT encoded —
    // it is re-derived by `inlineImageLinkVisitor` on the next save or
    // read, so the relation ids are all the markup needs to carry.
    it('reads an internal link relation back without the denormalised document bag', () => {
      const editor = editorWithImageNode()
      const img = document.createElement('img')
      img.setAttribute('src', baseAttributes.src)
      img.setAttribute('alt', 'A photograph of a heron')
      img.setAttribute('data-link-type', 'internal')
      img.setAttribute('data-link-target-document-id', 'doc-1')
      img.setAttribute('data-link-target-collection-id', 'coll-pages')
      img.setAttribute('data-link-target-collection-path', 'pages')

      let link: LinkAttributes | undefined
      editor.update(
        () => {
          const output = InlineImageNode.importDOM()?.img?.(img)?.conversion(img)
          const node = output?.node
          link = $isInlineImageNode(node) ? node.getLink() : undefined
        },
        { discrete: true }
      )
      expect(link).toEqual({
        linkType: 'internal',
        newTab: false,
        targetDocumentId: 'doc-1',
        targetCollectionId: 'coll-pages',
        targetCollectionPath: 'pages',
      })
    })

    it('produces no link for an ordinary pasted image', () => {
      const editor = editorWithImageNode()
      const img = document.createElement('img')
      img.setAttribute('src', 'https://example.com/plain.jpg')
      img.setAttribute('alt', 'Plain')

      let link: LinkAttributes | undefined = customLink
      editor.update(
        () => {
          const output = InlineImageNode.importDOM()?.img?.(img)?.conversion(img)
          const node = output?.node
          link = $isInlineImageNode(node) ? node.getLink() : undefined
        },
        { discrete: true }
      )
      expect(link).toBeUndefined()
    })
  })
})
