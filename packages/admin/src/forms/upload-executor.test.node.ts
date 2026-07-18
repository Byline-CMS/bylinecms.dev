/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { Field } from '@byline/core'
import { describe, expect, it, vi } from 'vitest'

import { executeUploads } from './upload-executor'
import type { PendingUpload } from './form-context'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Schema mirroring the publications files-array shape. */
const publicationsFields: Field[] = [
  { name: 'title', label: 'Title', type: 'text' },
  { name: 'serialNumber', label: 'Serial', type: 'counter', group: 'test-serial' },
  {
    name: 'files',
    label: 'Files',
    type: 'array',
    fields: [
      {
        name: 'filesGroup',
        type: 'group',
        fields: [
          {
            name: 'publicationFile',
            label: 'File',
            type: 'file',
            upload: {
              mimeTypes: ['application/pdf'],
              context: ['language', '/serialNumber', '../missingSibling'],
            },
          },
          {
            name: 'language',
            label: 'Language',
            type: 'relation',
            targetCollection: 'languages',
          },
        ],
      },
    ],
  },
  {
    name: 'cover',
    label: 'Cover',
    type: 'image',
    upload: { mimeTypes: ['image/*'] },
  },
]

/**
 * Two block types that both declare an array named `gallery`, each holding a
 * different upload-capable leaf. Leaf names stay unique across the
 * collection, so this passes the boot-time uniqueness constraint — the shape
 * is legal, and it is the shape that made block resolution ambiguous.
 */
const blocksFields: Field[] = [
  { name: 'title', label: 'Title', type: 'text' },
  {
    name: 'content',
    label: 'Content',
    type: 'blocks',
    blocks: [
      {
        blockType: 'photoBlock',
        fields: [
          {
            name: 'gallery',
            label: 'Gallery',
            type: 'array',
            fields: [
              {
                name: 'heroImage',
                label: 'Hero',
                type: 'image',
                upload: { context: ['/title'] },
              },
            ],
          },
        ],
      },
      {
        blockType: 'videoBlock',
        fields: [
          {
            name: 'gallery',
            label: 'Gallery',
            type: 'array',
            fields: [
              {
                name: 'poster',
                label: 'Poster',
                type: 'image',
                upload: { context: ['/title'] },
              },
            ],
          },
        ],
      },
    ],
  },
]

/** Form state for `blocksFields`: a photoBlock then a videoBlock. */
const blocksFormValues = () => ({
  title: 'Hello',
  content: [
    { _type: 'photoBlock', _id: 'blk-photo', gallery: [{}] },
    { _type: 'videoBlock', _id: 'blk-video', gallery: [{}] },
  ],
})

function imageUpload(name = 'p.png'): PendingUpload {
  return {
    file: new File(['x'], name, { type: 'image/png' }),
    previewUrl: 'blob:mock',
    collectionPath: 'pages',
  }
}

function pendingUpload(name = 'test.pdf'): PendingUpload {
  return {
    file: new File(['%PDF'], name, { type: 'application/pdf' }),
    previewUrl: 'blob:mock',
    collectionPath: 'publications',
  }
}

/** Capture the FormData each call receives; echo a minimal result. */
function captureUploadField() {
  const bodies: FormData[] = []
  const fn = vi.fn(async (_collection: string, formData: FormData) => {
    bodies.push(formData)
    return { storedFile: { fileId: '1', filename: 'stored.pdf' } as any }
  })
  return { fn, bodies }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeUploads — context transmission', () => {
  it('always sends field (leaf name) and fieldPath; documentId only when provided', async () => {
    const { fn, bodies } = captureUploadField()
    const uploads = new Map([['files[0].filesGroup.publicationFile', pendingUpload()]])

    await executeUploads(uploads, fn, {
      documentId: 'doc-123',
      fields: publicationsFields,
      getFormValues: () => ({}),
    })

    const body = bodies[0]!
    expect(body.get('field')).toBe('publicationFile')
    expect(body.get('fieldPath')).toBe('files[0].filesGroup.publicationFile')
    expect(body.get('documentId')).toBe('doc-123')
  })

  it('omits documentId in create mode (undefined)', async () => {
    const { fn, bodies } = captureUploadField()
    const uploads = new Map([['cover', pendingUpload('c.png')]])

    await executeUploads(uploads, fn, { fields: publicationsFields, getFormValues: () => ({}) })

    expect(bodies[0]?.get('documentId')).toBeNull()
  })

  it('resolves sibling, root-absolute, and missing context paths against the item scope', async () => {
    const { fn, bodies } = captureUploadField()
    const uploads = new Map([['files[1].filesGroup.publicationFile', pendingUpload()]])

    await executeUploads(uploads, fn, {
      documentId: 'doc-123',
      fields: publicationsFields,
      getFormValues: () => ({
        serialNumber: 447,
        files: [
          { filesGroup: { language: { targetDocumentId: 'lang-th', targetCollectionId: 'c' } } },
          { filesGroup: { language: { targetDocumentId: 'lang-en', targetCollectionId: 'c' } } },
        ],
      }),
    })

    const body = bodies[0]!
    // Sibling path reads THIS item's language, not item 0's.
    expect(body.get('language')).toBe('lang-en')
    // Root-absolute path.
    expect(body.get('serialNumber')).toBe('447')
    // Unresolvable context values are omitted, not sent as ''.
    expect(body.get('missingSibling')).toBeNull()
  })

  it('serialises relation envelopes to their targetDocumentId', async () => {
    const { fn, bodies } = captureUploadField()
    const uploads = new Map([['files[0].filesGroup.publicationFile', pendingUpload()]])

    await executeUploads(uploads, fn, {
      fields: publicationsFields,
      getFormValues: () => ({
        serialNumber: 1,
        files: [
          { filesGroup: { language: { targetDocumentId: 'lang-de', targetCollectionId: 'c' } } },
        ],
      }),
    })

    expect(bodies[0]?.get('language')).toBe('lang-de')
  })

  it('fields without upload.context send no extra entries', async () => {
    const { fn, bodies } = captureUploadField()
    const uploads = new Map([['cover', pendingUpload('c.png')]])

    await executeUploads(uploads, fn, {
      documentId: 'doc-9',
      fields: publicationsFields,
      getFormValues: () => ({ serialNumber: 5 }),
    })

    const body = bodies[0]!
    expect(body.get('field')).toBe('cover')
    expect(body.get('serialNumber')).toBeNull()
  })

  it('works without an execution context (legacy call shape)', async () => {
    const { fn, bodies } = captureUploadField()
    const uploads = new Map([['cover', pendingUpload('c.png')]])

    const result = await executeUploads(uploads, fn)

    expect(result.allSucceeded).toBe(true)
    const body = bodies[0]!
    expect(body.get('field')).toBe('cover')
    expect(body.get('fieldPath')).toBe('cover')
    expect(body.get('documentId')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Block resolution
//
// A form field path is an INSTANCE path — `content[1].gallery[0].poster` — and
// carries no block type, because a block item holds its own `_type`. Resolving
// an upload field inside a block therefore means reading that item.
// ---------------------------------------------------------------------------

describe('executeUploads — upload fields inside blocks', () => {
  it('resolves upload.context for a field in the first block', async () => {
    const { fn, bodies } = captureUploadField()
    const uploads = new Map([['content[0].gallery[0].heroImage', imageUpload('h.png')]])

    await executeUploads(uploads, fn, {
      fields: blocksFields,
      getFormValues: blocksFormValues,
    })

    expect(bodies[0]?.get('title')).toBe('Hello')
  })

  it('resolves upload.context for a field in a later block', async () => {
    // Regression: block resolution used to match the first block declaring a
    // field named by the next path segment. Both blocks declare `gallery`, so
    // `photoBlock` won, `poster` was not found in it, and the declared context
    // was dropped silently — no error, just a missing value the server-side
    // beforeStore / afterStore hooks were relying on.
    const { fn, bodies } = captureUploadField()
    const uploads = new Map([['content[1].gallery[0].poster', imageUpload()]])

    await executeUploads(uploads, fn, {
      fields: blocksFields,
      getFormValues: blocksFormValues,
    })

    expect(bodies[0]?.get('title')).toBe('Hello')
  })

  it('addresses a block item by stable id as well as position', async () => {
    const { fn, bodies } = captureUploadField()
    const uploads = new Map([['content[id=blk-video].gallery[0].poster', imageUpload()]])

    await executeUploads(uploads, fn, {
      fields: blocksFields,
      getFormValues: blocksFormValues,
    })

    expect(bodies[0]?.get('title')).toBe('Hello')
  })

  it('still resolves when the addressed block item is missing from form state', async () => {
    // Form state can lag a pending upload. The item is what supplies `_type`,
    // so its absence drops us to the unique-match fallback — but the *field*
    // is a declaration, and `poster` is declared in exactly one block, so the
    // answer is unchanged. Staleness costs nothing here; genuine ambiguity
    // would still return nothing (see the ambiguous case below).
    const { fn, bodies } = captureUploadField()
    const uploads = new Map([['content[7].gallery[0].poster', imageUpload()]])

    await executeUploads(uploads, fn, {
      fields: blocksFields,
      getFormValues: blocksFormValues,
    })

    expect(bodies[0]?.get('title')).toBe('Hello')
    expect(bodies[0]?.get('fieldPath')).toBe('content[7].gallery[0].poster')
  })

  it('falls back to a unique match when form values cannot disambiguate', async () => {
    // Without data the block type is unknowable from the path. `poster` is
    // declared in exactly one block, so the answer is still unambiguous.
    const { fn, bodies } = captureUploadField()
    const uploads = new Map([['content[1].gallery[0].poster', imageUpload()]])

    await executeUploads(uploads, fn, {
      fields: blocksFields,
      getFormValues: () => ({ title: 'Hello' }),
    })

    expect(bodies[0]?.get('title')).toBe('Hello')
  })

  it('sends no context when the path genuinely identifies no single declaration', async () => {
    // Same leaf name in both blocks and no data to choose between them. A
    // guess would be wrong half the time, so nothing is sent.
    const ambiguous: Field[] = [
      { name: 'title', label: 'Title', type: 'text' },
      {
        name: 'content',
        label: 'Content',
        type: 'blocks',
        blocks: [
          {
            blockType: 'aBlock',
            fields: [
              { name: 'shared', label: 'S', type: 'image', upload: { context: ['/title'] } },
            ],
          },
          {
            blockType: 'bBlock',
            fields: [
              { name: 'shared', label: 'S', type: 'image', upload: { context: ['/title'] } },
            ],
          },
        ],
      },
    ]

    const { fn, bodies } = captureUploadField()
    const uploads = new Map([['content[1].shared', imageUpload()]])

    await executeUploads(uploads, fn, { fields: ambiguous, getFormValues: () => ({ title: 'x' }) })

    expect(bodies[0]?.get('title')).toBeNull()
  })
})
