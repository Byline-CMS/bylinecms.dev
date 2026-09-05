import { useEffect, useRef } from 'react'

import { useTranslation } from '@byline/i18n/react'
import { Alert, Button } from '@byline/ui/react'

import { getAdminRoutePath } from '../routes/admin-path.js'
import type { DocumentMutationIssue } from './document-mutation-state.js'

/** Persistent recovery for list, history and schedule views without local form drafts. */
export function DocumentMutationNotice({
  issue,
  scheduleNotice = false,
}: {
  issue: DocumentMutationIssue | null
  scheduleNotice?: boolean
}) {
  const { t } = useTranslation('byline-admin')
  const warning = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (issue) warning.current?.focus()
  }, [issue])
  if (!issue && !scheduleNotice) return null
  return (
    <div ref={warning} tabIndex={-1} role="alert" aria-live="assertive">
      {issue && (
        <Alert close={false} intent="warning" title={t(`documentConcurrency.${issue}Title`)}>
          <p>{t(`documentConcurrency.${issue}`)}</p>
          {issue !== 'committed' && (
            <Button type="button" onClick={() => window.location.reload()}>
              {t('documentConcurrency.reloadAction')}
            </Button>
          )}
        </Alert>
      )}
      {scheduleNotice && (
        <Alert close={false} intent="warning" title={t('documentConcurrency.schedulesTitle')}>
          <p>{t('documentConcurrency.schedules')}</p>
          <a href={getAdminRoutePath('scheduled-publications')}>
            {t('documentConcurrency.reviewSchedules')}
          </a>
        </Alert>
      )}
    </div>
  )
}
