import type { Logger as PinoLogger } from 'pino'
import { describe, expect, it, vi } from 'vitest'

import { resolveHooks, resolveUploadHooks } from '../@types/collection-types.js'
import { initBylineCore } from '../core.js'
import { commitHookAttachment, prepareHookAttachment } from './attach-hooks.js'
import type {
  CollectionDefinition,
  CollectionHooks,
  CollectionHooksLoader,
  FileField,
  IDbAdapter,
  ServerConfig,
  ServerHooksConfig,
  UploadHooks,
  UploadHooksLoader,
} from '../@types/index.js'

function collection(path = 'documents'): CollectionDefinition {
  return {
    path,
    labels: { singular: 'Document', plural: 'Documents' },
    fields: [{ name: 'title', type: 'text' }],
  }
}

function nestedUploadCollection(): {
  definition: CollectionDefinition
  nested: FileField
  arrayFile: FileField
  blockFile: FileField
} {
  const nested: FileField = { name: 'asset', type: 'file', upload: {} }
  const arrayFile: FileField = { name: 'publicationFile', type: 'file', upload: {} }
  const blockFile: FileField = { name: 'backgroundImage', type: 'file', upload: {} }
  return {
    definition: {
      path: 'documents',
      labels: { singular: 'Document', plural: 'Documents' },
      fields: [
        { name: 'metadata', type: 'group', fields: [nested] },
        {
          name: 'files',
          type: 'array',
          fields: [{ name: 'filesGroup', type: 'group', fields: [arrayFile] }],
        },
        {
          name: 'content',
          type: 'blocks',
          blocks: [{ blockType: 'hero', fields: [blockFile] }],
        },
      ],
    },
    nested,
    arrayFile,
    blockFile,
  }
}

describe('server hook attachment', () => {
  it('prepares without mutation, then attaches collection and canonical nested upload hooks', async () => {
    const { definition, nested, arrayFile, blockFile } = nestedUploadCollection()
    const collectionHooks = {} satisfies CollectionHooks
    const nestedHooks = {} satisfies UploadHooks
    const arrayLoader = vi.fn<UploadHooksLoader>(() => Promise.resolve({}))
    const blockHooks = {} satisfies UploadHooks

    const operations = prepareHookAttachment({
      collections: [definition],
      hooks: {
        collections: { documents: collectionHooks },
        uploads: {
          'documents.metadata.asset': nestedHooks,
          'documents.files.filesGroup.publicationFile': arrayLoader,
          'documents.content.hero.backgroundImage': blockHooks,
        },
      },
    })

    expect(definition.hooks).toBeUndefined()
    expect(nested.upload?.hooks).toBeUndefined()
    expect(arrayFile.upload?.hooks).toBeUndefined()
    expect(blockFile.upload?.hooks).toBeUndefined()

    commitHookAttachment(operations)

    expect(await resolveHooks(definition)).toBe(collectionHooks)
    expect(await resolveUploadHooks(nested.upload?.hooks)).toBe(nestedHooks)
    expect(await resolveUploadHooks(arrayFile.upload?.hooks)).toEqual({})
    expect(arrayLoader).toHaveBeenCalledOnce()
    expect(await resolveUploadHooks(blockFile.upload?.hooks)).toBe(blockHooks)
  })

  it('rejects unknown collection, field, block, and non-upload targets', () => {
    const { definition } = nestedUploadCollection()
    const cases: ServerHooksConfig[] = [
      { collections: { missing: {} } },
      { uploads: { 'missing.asset': {} } },
      { uploads: { 'documents.metadata.missing': {} } },
      { uploads: { 'documents.content.missing.backgroundImage': {} } },
      { uploads: { 'documents.metadata': {} } },
    ]

    for (const hooks of cases) {
      expect(() => prepareHookAttachment({ collections: [definition], hooks })).toThrow(
        /unknown|non-upload/
      )
    }
  })

  it('rejects definition-authored hooks and ownership drift', () => {
    const definition = collection()
    const authored = {} satisfies CollectionHooks
    definition.hooks = authored
    expect(prepareHookAttachment({ collections: [definition] })).toEqual([])
    expect(definition.hooks).toBe(authored)
    expect(() =>
      prepareHookAttachment({
        collections: [definition],
        hooks: { collections: { documents: {} } },
      })
    ).toThrow(/definition-authored/)

    definition.hooks = undefined
    const first = {} satisfies CollectionHooks
    commitHookAttachment(
      prepareHookAttachment({
        collections: [definition],
        hooks: { collections: { documents: first } },
      })
    )
    definition.hooks = authored
    expect(() =>
      prepareHookAttachment({
        collections: [definition],
        hooks: { collections: { documents: {} } },
      })
    ).toThrow(/changed outside ServerConfig\.hooks/)

    const { definition: uploadDefinition, nested } = nestedUploadCollection()
    if (!nested.upload) throw new Error('test fixture must be upload-capable')
    const authoredUpload = {} satisfies UploadHooks
    nested.upload.hooks = authoredUpload
    expect(prepareHookAttachment({ collections: [uploadDefinition] })).toEqual([])
    expect(nested.upload.hooks).toBe(authoredUpload)
    expect(() =>
      prepareHookAttachment({
        collections: [uploadDefinition],
        hooks: { uploads: { 'documents.metadata.asset': {} } },
      })
    ).toThrow(/definition-authored/)
  })

  it('replaces and removes registry-owned hooks across successful reinitialization', () => {
    const definition = collection()
    const first = vi.fn<CollectionHooksLoader>(() => Promise.resolve({}))
    const second = vi.fn<CollectionHooksLoader>(() => Promise.resolve({}))

    commitHookAttachment(
      prepareHookAttachment({
        collections: [definition],
        hooks: { collections: { documents: first } },
      })
    )
    expect(definition.hooks).toBe(first)

    commitHookAttachment(
      prepareHookAttachment({
        collections: [definition],
        hooks: { collections: { documents: second } },
      })
    )
    expect(definition.hooks).toBe(second)

    commitHookAttachment(prepareHookAttachment({ collections: [definition] }))
    expect(definition.hooks).toBeUndefined()
  })

  it('leaves prior registry hooks intact when init fails after preparation', async () => {
    const definition = collection()
    const stable = {} satisfies CollectionHooks
    const replacement = {} satisfies CollectionHooks
    commitHookAttachment(
      prepareHookAttachment({
        collections: [definition],
        hooks: { collections: { documents: stable } },
      })
    )

    const invalid: ServerConfig = {
      serverURL: 'https://example.test',
      collections: [definition],
      db: {} as IDbAdapter,
      hooks: { collections: { documents: replacement } },
      i18n: {
        interface: { defaultLocale: 'en', locales: ['en'] },
        content: { defaultLocale: 'en', locales: [] },
      },
    }

    await expect(initBylineCore(invalid, {} as PinoLogger)).rejects.toThrow(/translations bundle/i)
    expect(definition.hooks).toBe(stable)
  })

  it('rejects path-punctuation in registry segments and duplicate upload leaf names at boot', () => {
    expect(() => prepareHookAttachment({ collections: [collection('docs.archive')] })).toThrow(
      /grammar punctuation/
    )

    const dottedField = collection()
    dottedField.fields = [{ name: 'meta.asset', type: 'file', upload: {} }]
    expect(() => prepareHookAttachment({ collections: [dottedField] })).toThrow(
      /grammar punctuation/
    )

    const dottedBlock = collection()
    dottedBlock.fields = [
      {
        name: 'content',
        type: 'blocks',
        blocks: [{ blockType: 'hero.large', fields: [] }],
      },
    ]
    expect(() => prepareHookAttachment({ collections: [dottedBlock] })).toThrow(
      /grammar punctuation/
    )

    // Brackets delimit item selectors in instance paths, which field names
    // reach — so they are rejected for the same reason dots are.
    const bracketField = collection()
    bracketField.fields = [{ name: 'asset[0]', type: 'file', upload: {} }]
    expect(() => prepareHookAttachment({ collections: [bracketField] })).toThrow(
      /grammar punctuation/
    )

    const bracketBlock = collection()
    bracketBlock.fields = [
      {
        name: 'content',
        type: 'blocks',
        blocks: [{ blockType: 'hero[large]', fields: [] }],
      },
    ]
    expect(() => prepareHookAttachment({ collections: [bracketBlock] })).toThrow(
      /grammar punctuation/
    )

    const duplicate = collection()
    duplicate.fields = [
      { name: 'primary', type: 'group', fields: [{ name: 'asset', type: 'file', upload: {} }] },
      { name: 'secondary', type: 'group', fields: [{ name: 'asset', type: 'image', upload: {} }] },
    ]
    expect(() => prepareHookAttachment({ collections: [duplicate] })).toThrow(
      /duplicate upload-capable leaf name/
    )
  })
})
