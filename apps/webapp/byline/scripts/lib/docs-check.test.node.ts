import { describe, expect, it } from 'vitest'

import { checkDocSources, type DocSource } from './docs-check.js'

function source(filePath: string, title: string, path: string, body: string): DocSource {
  return {
    filePath,
    source: `---\ntitle: "${title}"\npath: "${path}"\n---\n\n# ${title}\n\n${body}`,
  }
}

describe('docs check', () => {
  it('accepts tree-aware sibling links and canonical heading fragments', () => {
    const result = checkDocSources([
      source('/docs/guide/index.md', 'Guide', 'guide', '[Child](./child.md#target-heading)'),
      source('/docs/guide/child.md', 'Child', 'child', '## Target heading'),
    ])

    expect(result.issues).toEqual([])
    expect(result).toMatchObject({ documents: 2, links: 1 })
  })

  it('reports unresolved documents, relative repository paths, and stale fragments', () => {
    const result = checkDocSources([
      source(
        '/docs/guide/index.md',
        'Guide',
        'guide',
        [
          '[Missing](./missing.md)',
          '[Source](../packages/source.ts)',
          '[Old heading](./child.md#target--heading)',
        ].join('\n\n')
      ),
      source('/docs/guide/child.md', 'Child', 'child', '## Target heading'),
    ])

    expect(result.issues.map((issue) => issue.kind)).toEqual([
      'unresolved-document',
      'relative-non-document',
      'missing-fragment',
    ])
  })

  it('reports frontmatter failures instead of silently omitting the file', () => {
    const result = checkDocSources([{ filePath: '/docs/note.md', source: '# No frontmatter' }])

    expect(result.documents).toBe(0)
    expect(result.issues).toEqual([
      expect.objectContaining({ kind: 'parse-error', filePath: '/docs/note.md' }),
    ])
  })

  it('reports a leading H1 that the importer cannot deduplicate', () => {
    const document = source('/docs/guide.md', 'Guide', 'guide', 'Body')
    const mismatched = {
      ...document,
      source: document.source.replace('# Guide', '# Byline guide'),
    }

    const result = checkDocSources([mismatched])

    expect(result.issues).toEqual([
      expect.objectContaining({
        kind: 'leading-h1-mismatch',
        detail: expect.stringContaining('will render as a duplicate title'),
      }),
    ])
  })
})
