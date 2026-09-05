/** Internal ownership constraint for singleton historical reads. */
export const expectedDocumentId = Symbol('byline.expectedDocumentId')

export interface DocumentBoundFindByVersionOptions {
  [expectedDocumentId]?: string
}

/** Internal singleton slot read; shares the collection reader's authorization pipeline. */
export const readSingletonForEdit = Symbol('byline.readSingletonForEdit')
