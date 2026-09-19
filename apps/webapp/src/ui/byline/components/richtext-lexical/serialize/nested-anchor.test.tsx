/**
 * Nested-anchor guard for the richtext serializer.
 *
 * An inline image carries its own optional click target, so a linked image
 * sitting inside a text link would emit `<a>` inside `<a>`. That is not
 * valid HTML: the parser un-nests it, which changes the document structure
 * and drags the surrounding layout with it.
 *
 * Reachable in production, not hypothetical — `import-docs` maps markdown
 * `[![alt](img)](url)` onto a `link` node whose children include an
 * `inline-image` node (`walkInlines` → `inlineImageNode`), and the image
 * dialog can then give that image a link of its own.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Serialize } from './index.tsx'

const image = {
  fileId: 'f1',
  filename: 'a.jpg',
  originalFilename: 'a.jpg',
  mimeType: 'image/jpeg',
  fileSize: 1,
  storageProvider: 'local',
  storagePath: 'a.jpg',
  storageUrl: '/uploads/a.jpg',
  imageWidth: 100,
  imageHeight: 100,
  processingStatus: 'complete',
  variants: [],
}

const linkedImage = {
  type: 'inline-image',
  version: 1,
  src: '/uploads/a.jpg',
  altText: 'Alt',
  position: 'full',
  showCaption: false,
  document: { image },
  link: { linkType: 'custom', url: 'https://inner.example.com', newTab: false },
}

function renderTree(nodes: unknown[]) {
  return renderToStaticMarkup(
    <Serialize
      nodes={nodes as never}
      lng={'en' as never}
      options={{ renderParagraphInline: false, disableAnimation: true }}
    />
  )
}

/** True when an anchor opens before the preceding one has closed. */
function hasNestedAnchor(html: string): boolean {
  let depth = 0
  for (const token of html.match(/<a[\s>]|<\/a>/g) ?? []) {
    if (token === '</a>') {
      depth -= 1
    } else {
      depth += 1
      if (depth > 1) return true
    }
  }
  return false
}

describe('linked image inside a text link', () => {
  const tree = [
    {
      type: 'link',
      version: 1,
      attributes: { linkType: 'custom', url: 'https://outer.example.com', newTab: false },
      children: [{ type: 'text', version: 1, text: 'see ', format: 0 }, linkedImage],
    },
  ]

  it('never emits an anchor inside an anchor', () => {
    expect(hasNestedAnchor(renderTree(tree))).toBe(false)
  })

  it('keeps the outer text link', () => {
    expect(renderTree(tree)).toContain('https://outer.example.com')
  })

  it('drops the inner image link rather than the image', () => {
    const html = renderTree(tree)
    expect(html).not.toContain('https://inner.example.com')
    expect(html).toContain('<img')
  })

  // A link node whose target the walker could not resolve renders its
  // children plain — no anchor at all (`LinkLexicalSerializer` short-circuits
  // on an empty href). Suppressing the image's own anchor in that case costs
  // a working link for no benefit: there is no outer anchor to nest inside.
  it('keeps the image link when the surrounding link renders no anchor', () => {
    const html = renderTree([
      {
        type: 'link',
        version: 1,
        attributes: {
          linkType: 'internal',
          targetDocumentId: 'gone',
          targetCollectionId: 'c1',
          targetCollectionPath: 'pages',
          document: { _resolved: false },
        },
        children: [{ type: 'text', version: 1, text: 'see ', format: 0 }, linkedImage],
      },
    ])
    expect(html).toContain('https://inner.example.com')
    expect(hasNestedAnchor(html)).toBe(false)
  })

  it('keeps the image link when the surrounding link has an empty custom url', () => {
    const html = renderTree([
      {
        type: 'link',
        version: 1,
        attributes: { linkType: 'custom', url: '' },
        children: [linkedImage],
      },
    ])
    expect(html).toContain('https://inner.example.com')
  })

  // The caption is serialized in a nested pass. It can contain its own
  // links, so the anchor context has to travel with it — otherwise a
  // caption link inside a text-linked image nests an anchor even though
  // the image's own anchor was correctly suppressed.
  it('suppresses a caption link when the image sits inside a text link', () => {
    const captioned = {
      ...linkedImage,
      showCaption: true,
      caption: {
        editorState: {
          root: {
            type: 'root',
            version: 1,
            children: [
              {
                type: 'paragraph',
                version: 1,
                children: [
                  {
                    type: 'link',
                    version: 1,
                    attributes: { linkType: 'custom', url: 'https://caption.example.com' },
                    children: [{ type: 'text', version: 1, text: 'source', format: 0 }],
                  },
                ],
              },
            ],
          },
        },
      },
    }
    const html = renderTree([
      {
        type: 'link',
        version: 1,
        attributes: { linkType: 'custom', url: 'https://outer.example.com', newTab: false },
        children: [captioned],
      },
    ])
    expect(hasNestedAnchor(html)).toBe(false)
    expect(html).toContain('source')
  })

  it('keeps a caption link when the image is not inside a text link', () => {
    const captioned = {
      ...linkedImage,
      link: undefined,
      showCaption: true,
      caption: {
        editorState: {
          root: {
            type: 'root',
            version: 1,
            children: [
              {
                type: 'paragraph',
                version: 1,
                children: [
                  {
                    type: 'link',
                    version: 1,
                    attributes: { linkType: 'custom', url: 'https://caption.example.com' },
                    children: [{ type: 'text', version: 1, text: 'source', format: 0 }],
                  },
                ],
              },
            ],
          },
        },
      },
    }
    const html = renderTree([{ type: 'paragraph', version: 1, children: [captioned] }])
    expect(html).toContain('https://caption.example.com')
    expect(hasNestedAnchor(html)).toBe(false)
  })

  it('leaves a linked image outside any text link with its own anchor', () => {
    const html = renderTree([{ type: 'paragraph', version: 1, children: [linkedImage] }])
    expect(html).toContain('https://inner.example.com')
    expect(hasNestedAnchor(html)).toBe(false)
  })
})
