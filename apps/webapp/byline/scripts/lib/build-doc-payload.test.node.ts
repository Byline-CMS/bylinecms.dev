import { describe, expect, it } from 'vitest'

import { buildDocPayload, carryForwardPublishedOn } from './build-doc-payload.js'

const frontmatter = { title: 'CLI' }
const lexicalState = { root: {} }
const now = new Date('2026-09-16T09:00:00.000Z')

describe('import-docs payload', () => {
  it('supplies publishedOn when the frontmatter omits it', () => {
    // `publishedOn` is a required field on the docs collection, and the docs
    // front-matter contract does not carry one. Without a value every write
    // fails validation with 'Published On is required'.
    const payload = buildDocPayload({ frontmatter, lexicalState, featureImage: null, now })
    expect(payload.publishedOn).toEqual(now)
  })

  it('keeps an explicit frontmatter publishedOn', () => {
    const authored = new Date('2024-01-15T10:00:00.000Z')
    const payload = buildDocPayload({
      frontmatter: { ...frontmatter, publishedOn: authored },
      lexicalState,
      featureImage: null,
      now,
    })
    expect(payload.publishedOn).toEqual(authored)
  })

  it('omits optional fields the frontmatter does not carry', () => {
    // A deliberately minimal fixture: this asserts the builder's own contract,
    // not that the result satisfies the docs collection (it does not — the
    // collection requires `summary`). Payload-against-schema coverage lives in
    // `import-payload-schema.test.node.ts`.

    const payload = buildDocPayload({ frontmatter, lexicalState, featureImage: null, now })
    expect('summary' in payload).toBe(false)
    expect('featureImage' in payload).toBe(false)
    expect(payload.title).toBe('CLI')
    expect(payload.content).toEqual([
      { _type: 'richTextBlock', richText: lexicalState, constrainedWidth: true },
    ])
  })

  it('carries the stored publishedOn forward on update rather than dropping the key', () => {
    // An update is a whole-document replace: deleting the key writes a version
    // without it, which both fails validation and loses the editorial value.
    const stored = new Date('2024-01-15T10:00:00.000Z')
    const payload = buildDocPayload({ frontmatter, lexicalState, featureImage: null, now })
    carryForwardPublishedOn(payload, { fields: { publishedOn: stored } })
    expect(payload.publishedOn).toEqual(stored)
  })

  it('keeps the imported publishedOn when the stored document has none', () => {
    const payload = buildDocPayload({ frontmatter, lexicalState, featureImage: null, now })
    carryForwardPublishedOn(payload, { fields: {} })
    expect(payload.publishedOn).toEqual(now)
  })
})
