/**
 * Public-render contract for an inline image's optional click target.
 *
 * Rendered through `renderToStaticMarkup` rather than a testing library:
 * the assertions here are about emitted markup — which element wraps which,
 * and which attributes ride along — so the HTML string is the honest
 * subject. No DOM interaction is involved.
 *
 * `LangLink` needs a live TanStack Router context, so the root-relative
 * branch is exercised through the serializer's own output shape in the
 * nesting suite rather than rendered standalone here.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { InlineImageSerializer } from './index.tsx'
import type { SerializeOptions } from '../richtext-lexical/serialize/index.tsx'

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

function imageNode(link: unknown, showCaption = false) {
  return {
    type: 'inline-image',
    version: 1,
    src: '/uploads/a.jpg',
    altText: 'Alt',
    position: 'full',
    showCaption,
    document: { image },
    link,
  } as never
}

function render(node: never, options?: Partial<SerializeOptions>) {
  return renderToStaticMarkup(
    <InlineImageSerializer
      node={node}
      serialize={(() => <span>caption</span>) as never}
      lng={'en' as never}
      options={{ renderParagraphInline: false, disableAnimation: true, ...options } as never}
    />
  )
}

/** The opening tag of the first anchor, or null when none was emitted. */
function anchorTag(html: string): string | null {
  return html.match(/<a[^>]*>/)?.[0] ?? null
}

describe('inline image — new-tab setting', () => {
  // The dialog's "Open in new tab" checkbox has to mean something. The text
  // link helper forces `_blank` on every external href regardless, which
  // would make the checkbox a no-op for exactly the URLs it matters most for.
  it('opens an external target in a new tab when the editor asked for it', () => {
    const html = render(imageNode({ linkType: 'custom', url: 'https://example.com', newTab: true }))
    expect(anchorTag(html)).toContain('target="_blank"')
  })

  it('does NOT open an external target in a new tab when the editor did not', () => {
    const html = render(
      imageNode({ linkType: 'custom', url: 'https://example.com', newTab: false })
    )
    expect(anchorTag(html)).not.toContain('target="_blank"')
  })

  it('treats an absent newTab as "same tab"', () => {
    const html = render(imageNode({ linkType: 'custom', url: 'https://example.com' }))
    expect(anchorTag(html)).not.toContain('target="_blank"')
  })

  // Stated rather than relied upon: the HTML standard has `target="_blank"`
  // imply `noopener` already, so this pins the guarantee rather than
  // patching a live hole. Matches what text links emit for `newTab`.
  it('states rel="noopener" explicitly on a new-tab anchor', () => {
    const html = render(imageNode({ linkType: 'custom', url: 'https://example.com', newTab: true }))
    expect(anchorTag(html) ?? '').toContain('rel="noopener"')
  })

  it('emits no rel when the link stays in the same tab', () => {
    const html = render(
      imageNode({ linkType: 'custom', url: 'https://example.com', newTab: false })
    )
    expect(anchorTag(html)).not.toContain('rel=')
  })
})

describe('inline image — anchor suppression', () => {
  it('renders no anchor for an image with no link', () => {
    expect(anchorTag(render(imageNode(undefined)))).toBeNull()
  })

  it('renders no anchor when the walker marked the target unresolved', () => {
    const html = render(
      imageNode({
        linkType: 'internal',
        targetDocumentId: 'd1',
        targetCollectionId: 'c1',
        targetCollectionPath: 'pages',
        document: { _resolved: false },
      })
    )
    expect(anchorTag(html)).toBeNull()
  })

  // `<a>` inside `<a>` is un-nested by the HTML parser, which silently
  // restructures the document. Reachable: `import-docs` turns markdown
  // `[![alt](img)](url)` into a link node containing an inline image, and
  // the image dialog can then give that image its own link.
  it('suppresses its own anchor when already inside a text link', () => {
    const html = render(
      imageNode({ linkType: 'custom', url: 'https://inner.example.com', newTab: false }),
      { insideLink: true }
    )
    expect(anchorTag(html)).toBeNull()
  })

  it('still renders the image itself when the anchor is suppressed', () => {
    const html = render(imageNode({ linkType: 'custom', url: 'https://inner.example.com' }), {
      insideLink: true,
    })
    expect(html).toContain('<img')
    expect(html).toContain('alt="Alt"')
  })
})

describe('inline image — caption stays outside the anchor', () => {
  it('does not wrap the caption in the image link', () => {
    const html = render(
      imageNode({ linkType: 'custom', url: 'https://example.com', newTab: false }, true)
    )
    const closeAnchor = html.indexOf('</a>')
    const caption = html.indexOf('inline-image-block--caption')
    expect(closeAnchor).toBeGreaterThan(-1)
    expect(caption).toBeGreaterThan(closeAnchor)
  })
})
