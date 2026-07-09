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
