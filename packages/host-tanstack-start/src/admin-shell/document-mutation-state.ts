import { useRef, useState } from 'react'

import {
  ErrorCodes,
  getDocumentRevisionValidationDetails,
  getDocumentStaleDetails,
  getLockConflictDetails,
  parseDocumentRevision,
} from '@byline/core'
import { getDocumentHookCommittedDetails } from '@byline/core/services'

import { committedTreeReceipt, structuralReceipt } from '../server-fns/structural-receipt.js'

export type DocumentMutationIssue = 'stale' | 'reload' | 'lock' | 'unavailable' | 'committed'

function documentMutationIssue(error: unknown): DocumentMutationIssue | null {
  if (getDocumentStaleDetails(error)) return 'stale'
  if (getDocumentRevisionValidationDetails(error)) return 'reload'
  if (getLockConflictDetails(error)) return 'lock'
  if (getDocumentHookCommittedDetails(error) || committedTreeReceipt(error)) return 'committed'
  if (
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'code') === ErrorCodes.NOT_FOUND
  )
    return 'unavailable'
  return null
}

/** A rejected observation stays frozen until an explicit editor reload. */
export function useDocumentMutationState<
  T extends { id?: unknown; versionId?: unknown; revision?: unknown },
>(document: T | null | undefined) {
  const [issue, setIssue] = useState<DocumentMutationIssue | null>(null)
  const [scheduleNotice, setScheduleNotice] = useState(false)
  const [, setReceiptRevision] = useState<number | undefined>()
  const blockedError = useRef<unknown>(undefined)
  const observation = useRef({ identity: document, revision: document?.revision })
  if (
    observation.current.identity !== document &&
    blockedError.current === undefined &&
    document?.revision === observation.current.revision
  ) {
    observation.current = { identity: document, revision: document?.revision }
  }
  const assertWritable = () => {
    if (blockedError.current !== undefined) throw blockedError.current
  }
  const expectedRevision = () => {
    assertWritable()
    return parseDocumentRevision(observation.current.revision)
  }
  const adopt = (receipt: {
    documentId: string
    revision: number
    scheduledPublicationsNeedReconfirmation?: boolean
  }) => {
    if (blockedError.current !== undefined) return
    if (document?.id != null && receipt.documentId !== document.id) return
    observation.current.revision = parseDocumentRevision(receipt.revision)
    setReceiptRevision(receipt.revision)
    if (receipt.scheduledPublicationsNeedReconfirmation) setScheduleNotice(true)
  }
  const reportStructure = (result: unknown) => {
    const receipt = structuralReceipt(result)
    if (receipt) adopt(receipt)
  }
  const report = (error: unknown): 'blocked' | 'committed' | null => {
    const kind = documentMutationIssue(error)
    if (kind === null) return null
    if (kind === 'committed') {
      if (blockedError.current !== undefined) return 'blocked'
      const details = getDocumentHookCommittedDetails(error) ?? committedTreeReceipt(error)
      if (details) adopt(details)
      setIssue(kind)
      return 'committed'
    }
    blockedError.current = error
    setIssue(kind)
    return 'blocked'
  }
  return {
    issue,
    blocked: issue !== null && issue !== 'committed',
    scheduleNotice,
    document: observation.current.identity,
    revision:
      typeof observation.current.revision === 'number' ? observation.current.revision : undefined,
    expectedRevision,
    assertWritable,
    adopt,
    report,
    reportStructure,
  }
}
