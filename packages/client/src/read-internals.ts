/** Internal ownership constraint for singleton historical reads. */
export const expectedDocumentId = Symbol('byline.expectedDocumentId')

export interface DocumentBoundFindByVersionOptions {
  [expectedDocumentId]?: string
}
