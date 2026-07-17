import { describe, expect, it } from 'vitest'

import { buildCanonicalSourcePathMap } from './import-docs-tree.js'
import { parseBodyToMdast } from './parse-markdown.js'
import { rewriteDocLinks } from './rewrite-doc-links.js'

describe('rewriteDocLinks', () => {
  it('rewrites a sibling link to its canonical tree route', () => {
    const root = parseBodyToMdast('[Fields](./01-fields.md#schema-paths-vs-instance-paths)')
    const pathMap = buildCanonicalSourcePathMap([
      { filePath: '/docs/04-collections/index.md', path: 'collections' },
      { filePath: '/docs/04-collections/01-fields.md', path: 'fields' },
      { filePath: '/docs/04-collections/02-blocks.md', path: 'blocks' },
    ])

    const warnings = rewriteDocLinks(root, {
      sourceFilePath: '/docs/04-collections/02-blocks.md',
      pathMap,
      urlPrefix: '/docs',
    })

    expect(root.children[0]).toMatchObject({
      children: [
        {
          type: 'link',
          url: '/docs/collections/fields#schema-paths-vs-instance-paths',
        },
      ],
    })
    expect(warnings).toEqual([
      {
        kind: 'rewritten-doc-link',
        href: './01-fields.md#schema-paths-vs-instance-paths',
        resolvedTo: '/docs/collections/fields#schema-paths-vs-instance-paths',
      },
    ])
  })

  it('reports and unwraps a markdown target outside the import set', () => {
    const root = parseBodyToMdast('[Design](../DESIGN.md)')

    const warnings = rewriteDocLinks(root, {
      sourceFilePath: '/docs/guide/page.md',
      pathMap: new Map(),
      urlPrefix: '/docs',
    })

    expect(root.children[0]).toMatchObject({
      children: [{ type: 'text', value: 'Design' }],
    })
    expect(warnings).toEqual([{ kind: 'unresolved-doc-link', href: '../DESIGN.md' }])
  })
})
