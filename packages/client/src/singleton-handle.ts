/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { RequestContext } from '@byline/auth'
import type {
  ChangeStatusResult,
  DocumentLifecycleContext,
  DocumentPublishSchedule,
  DocumentWritePrecondition,
  ReadContext,
  ReadMode,
  SingletonAbilityVerb,
  SingletonDefinition,
  SingletonSaveResult,
  UnpublishResult,
  UpdateSingletonResult,
} from '@byline/core'
import {
  assertActorCanPerform,
  cancelDocumentScheduledPublish,
  changeDocumentStatus,
  confirmDocumentScheduledPublish,
  copySingletonToLocale,
  createReadContext,
  ERR_NOT_FOUND,
  getDocumentScheduledPublish,
  resolveSingletonDocumentId,
  restoreSingletonVersion,
  scheduleDocumentPublish,
  unpublishDocument,
  updateSingleton,
} from '@byline/core'

import { CollectionHandle } from './collection-handle.js'
import { resolveReadRequestContext } from './read-context.js'
import {
  type DocumentBoundFindByVersionOptions,
  expectedDocumentId,
  readSingletonForEdit,
} from './read-internals.js'
import type { BylineClient } from './client.js'
import type {
  ClientDocument,
  ConfirmScheduledPublishOptions,
  DocumentPublishScheduleInfo,
  EditableSingleton,
  FindByIdForEditOptions,
  FindByVersionOptions,
  FindResult,
  GetSingletonOptions,
  HistoryOptions,
  SchedulePublishOptions,
  SingletonDocument,
  UpdateSingletonOptions,
} from './types.js'

function toScheduleInfo(schedule: DocumentPublishSchedule): DocumentPublishScheduleInfo {
  const {
    executionToken: _executionToken,
    executionExpiresAt: _executionExpiresAt,
    ...info
  } = schedule
  return info
}

/**
 * A document-ID-free handle for one registered singleton slot.
 *
 * Reads deliberately delegate to the collection document reader only after
 * the singleton read ability and slot mapping have been resolved in that
 * order. This keeps reconstruction, hooks, populate, and response shaping
 * identical without exposing collection-only operations on this handle.
 */
export class SingletonHandle<TFields extends Record<string, any> = Record<string, any>> {
  private readonly client: BylineClient<any, any>
  private readonly definition: SingletonDefinition
  private readonly reader: CollectionHandle<TFields>

  constructor(client: BylineClient<any, any>, definition: SingletonDefinition) {
    this.client = client
    this.definition = definition
    this.reader = new CollectionHandle<TFields>(client, definition)
  }

  async get(
    options: GetSingletonOptions<TFields> = {}
  ): Promise<SingletonDocument<TFields> | null> {
    const readContext = options._readContext ?? createReadContext()
    await this.authorizeRead(options.status ?? 'published', readContext)
    const documentId = await this.resolveMappedDocumentId()
    if (documentId == null) return null

    const document = await this.reader.findById(documentId, {
      ...options,
      _readContext: readContext,
    })
    if (document == null) return null
    const { path: _path, ...singleton } = document
    return singleton
  }

  async getForEdit(
    options: FindByIdForEditOptions<TFields> = {}
  ): Promise<EditableSingleton<TFields> | null> {
    return this.reader[readSingletonForEdit](options)
  }

  async update(data: TFields, options: UpdateSingletonOptions): Promise<UpdateSingletonResult> {
    const ctx = await this.buildAuthorizedLifecycleContext(['update'])
    return updateSingleton(ctx, { data, ...options })
  }

  async changeStatus(
    nextStatus: string,
    options: DocumentWritePrecondition
  ): Promise<ChangeStatusResult> {
    const abilities: SingletonAbilityVerb[] = ['changeStatus']
    if (nextStatus === 'published') abilities.push('publish')
    const { ctx, documentId } = await this.resolveRequiredDocument(abilities)
    return changeDocumentStatus(ctx, {
      documentId,
      nextStatus,
      expectedRevision: options?.expectedRevision,
    })
  }

  async unpublish(options: DocumentWritePrecondition): Promise<UnpublishResult> {
    const { ctx, documentId } = await this.resolveRequiredDocument(['changeStatus'])
    return unpublishDocument(ctx, { documentId, expectedRevision: options?.expectedRevision })
  }

  async schedulePublish(
    options: SchedulePublishOptions
  ): Promise<DocumentPublishScheduleInfo & { revision: number }> {
    const { ctx, documentId } = await this.resolveRequiredDocument(['changeStatus', 'publish'])
    const result = await scheduleDocumentPublish(ctx, { documentId, ...options })
    return { ...toScheduleInfo(result), revision: result.revision }
  }

  async confirmScheduledPublish(
    options: ConfirmScheduledPublishOptions
  ): Promise<DocumentPublishScheduleInfo & { revision: number }> {
    const { ctx, documentId } = await this.resolveRequiredDocument(['changeStatus', 'publish'])
    const result = await confirmDocumentScheduledPublish(ctx, { documentId, ...options })
    return { ...toScheduleInfo(result), revision: result.revision }
  }

  async cancelScheduledPublish(
    options: DocumentWritePrecondition
  ): Promise<{ schedule: DocumentPublishScheduleInfo | null; revision: number }> {
    const { ctx, documentId } = await this.resolveRequiredDocument(['changeStatus', 'publish'])
    const result = await cancelDocumentScheduledPublish(ctx, {
      documentId,
      expectedRevision: options?.expectedRevision,
    })
    return {
      schedule: result.schedule == null ? null : toScheduleInfo(result.schedule),
      revision: result.revision,
    }
  }

  async getScheduledPublish(): Promise<DocumentPublishScheduleInfo | null> {
    const ctx = await this.buildAuthorizedLifecycleContext(['changeStatus', 'publish'])
    const documentId = await resolveSingletonDocumentId(ctx)
    if (documentId == null) return null
    const schedule = await getDocumentScheduledPublish(ctx, { documentId })
    return schedule == null ? null : toScheduleInfo(schedule)
  }

  async history<F = TFields>(options: HistoryOptions = {}): Promise<FindResult<F>> {
    const readContext = options._readContext ?? createReadContext()
    await this.authorizeRead('any', readContext)
    const documentId = await this.resolveMappedDocumentId()
    if (documentId == null) {
      const page = options.page ?? 1
      const pageSize = options.pageSize ?? 20
      return { docs: [], meta: { total: 0, page, pageSize, totalPages: 0 } }
    }
    return this.reader.history<F>(documentId, { ...options, _readContext: readContext })
  }

  async findByVersion<F = TFields>(
    versionId: string,
    options: FindByVersionOptions<F> = {}
  ): Promise<ClientDocument<F> | null> {
    const readContext = options._readContext ?? createReadContext()
    await this.authorizeRead('any', readContext)
    const documentId = await this.resolveMappedDocumentId()
    if (documentId == null) return null
    const boundOptions: FindByVersionOptions<F> & DocumentBoundFindByVersionOptions = {
      ...options,
      _readContext: readContext,
      [expectedDocumentId]: documentId,
    }
    return this.reader.findByVersion<F>(versionId, boundOptions)
  }

  async restoreVersion(
    sourceVersionId: string,
    options: DocumentWritePrecondition
  ): Promise<SingletonSaveResult> {
    const ctx = await this.buildAuthorizedLifecycleContext(['update'])
    return restoreSingletonVersion(ctx, {
      sourceVersionId,
      expectedRevision: options?.expectedRevision,
    })
  }

  async copyToLocale(args: {
    expectedRevision: number
    sourceLocale: string
    targetLocale: string
    overwrite?: boolean
  }): Promise<SingletonSaveResult> {
    const ctx = await this.buildAuthorizedLifecycleContext(['update'])
    return copySingletonToLocale(ctx, { ...args, overwrite: args.overwrite ?? false })
  }

  private async authorizeRead(
    readMode: ReadMode,
    readContext: ReadContext
  ): Promise<RequestContext> {
    const requestContext = await resolveReadRequestContext(this.client, readContext, readMode)
    assertActorCanPerform(requestContext, this.definition, 'read')
    return requestContext
  }

  private async buildAuthorizedLifecycleContext(
    abilities: readonly SingletonAbilityVerb[]
  ): Promise<DocumentLifecycleContext> {
    const requestContext = await this.client.resolveRequestContext()
    for (const ability of abilities) {
      assertActorCanPerform(requestContext, this.definition, ability)
    }
    const { id: collectionId, version: collectionVersion } =
      await this.client.resolveCollectionRecord(this.definition.path)
    return {
      db: this.client.db,
      definition: this.definition,
      collectionId,
      collectionVersion,
      collectionPath: this.definition.path,
      storage: this.client.storage,
      logger: this.client.logger,
      defaultLocale: this.client.defaultLocale,
      slugifier: this.client.slugifier,
      requestContext,
    }
  }

  private async resolveMappedDocumentId(): Promise<string | null> {
    const collectionId = await this.client.resolveCollectionId(this.definition.path)
    return this.client.db.queries.singletons.getMappedDocumentId(collectionId)
  }

  private async resolveRequiredDocument(
    abilities: readonly SingletonAbilityVerb[]
  ): Promise<{ ctx: DocumentLifecycleContext; documentId: string }> {
    const ctx = await this.buildAuthorizedLifecycleContext(abilities)
    const documentId = await resolveSingletonDocumentId(ctx)
    if (documentId == null) {
      throw ERR_NOT_FOUND({
        message: `singleton '${this.definition.path}' has not been saved`,
        details: { singletonPath: this.definition.path },
      })
    }
    return { ctx, documentId }
  }
}
