/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useRouter, useRouterState } from '@tanstack/react-router'

import { StatusBadge } from '@byline/admin/react'
import type {
  SingletonAdminConfig,
  SingletonDefinition,
  SingletonPreviewDocument,
  WorkflowStatus,
} from '@byline/core'
import { parseDocumentRevision } from '@byline/core'
import { useTranslation } from '@byline/i18n/react'
import { Button, Container, Section, Table } from '@byline/ui/react'
import cx from 'clsx'

import { getAdminRoutePath } from '../../routes/admin-path.js'
import {
  findSingletonByVersion,
  restoreSingletonVersion,
} from '../../server-fns/singletons/index.js'
import { useNavigate } from '../chrome/loose-router.js'
import historyStyles from '../collections/history.module.css'
import {
  HistoryStats,
  VersionHistoryCore,
  type VersionHistoryData,
  type VersionHistoryRowPresentation,
} from '../collections/version-history.js'
import { SingletonViewMenu } from './view-menu.js'
import type { ContentLocaleOption } from '../collections/view-menu.js'

export function SingletonHistoryView({
  singletonDefinition,
  adminConfig,
  data,
  currentDocument,
  contentLocales,
  defaultContentLocale,
  workflowStatuses,
}: {
  singletonDefinition: SingletonDefinition
  adminConfig?: SingletonAdminConfig
  data: VersionHistoryData
  currentDocument?: Record<string, unknown> | null
  contentLocales: ReadonlyArray<ContentLocaleOption>
  defaultContentLocale: string
  workflowStatuses: WorkflowStatus[]
}) {
  const singleton = singletonDefinition.path
  const navigate = useNavigate()
  const router = useRouter()
  const location = useRouterState({ select: (state) => state.location })
  const locale = (location.search as { locale?: string }).locale
  const { t } = useTranslation('byline-admin')

  function handlePageSizeChange(pageSize: number): void {
    const params = structuredClone(location.search)
    delete params.page
    params.page_size = pageSize
    navigate({
      to: getAdminRoutePath('singletons', '$singleton', 'history'),
      params: { singleton },
      search: params,
    })
  }

  const rowPresentation: VersionHistoryRowPresentation = {
    headers: (
      <>
        <th scope="col">{t('collections.history.statusColumn')}</th>
        <th scope="col">{t('collections.documentHistory.colWhen')}</th>
        <th scope="col">{t('collections.documentHistory.colActor')}</th>
        <th
          scope="col"
          className={cx('byline-coll-history-col-restore', historyStyles.colRestore)}
        />
      </>
    ),
    auditColSpan: 4,
    renderCells: ({
      document,
      versionId,
      currentVersionId,
      actorLabel,
      restoreStatusLabel,
      openRestore,
    }) => (
      <>
        <Table.Cell className="byline-singleton-history-status-cell">
          <StatusBadge status={document.status} workflowStatuses={workflowStatuses} />
        </Table.Cell>
        <Table.Cell className="byline-singleton-history-created-cell">
          {new Date(document.createdAt).toLocaleString()}
        </Table.Cell>
        <Table.Cell className="byline-singleton-history-actor-cell">{actorLabel}</Table.Cell>
        <Table.Cell className={cx('byline-coll-history-restore-cell', historyStyles.restoreCell)}>
          {versionId && versionId !== currentVersionId ? (
            <Button
              type="button"
              variant="outlined"
              size="xs"
              intent="noeffect"
              onClick={openRestore}
              className={cx('byline-coll-history-restore-button', historyStyles.restoreButton)}
              title={t('collections.history.restoreButtonTitle', {
                status: restoreStatusLabel,
              })}
            >
              {t('collections.history.restoreButton')}
            </Button>
          ) : null}
        </Table.Cell>
      </>
    ),
  }

  const documentId =
    currentDocument && typeof currentDocument.id === 'string' ? currentDocument.id : ''

  return (
    <>
      <Section>
        <Container>
          <div className={cx('byline-coll-history-head', historyStyles.head)}>
            <h2 className={cx('byline-coll-history-title', historyStyles.title)}>
              {t('collections.history.title', { label: singletonDefinition.label })}{' '}
              <HistoryStats total={data.meta.total} />
            </h2>
            <SingletonViewMenu
              singleton={singleton}
              activeView="history"
              locale={locale}
              contentLocales={contentLocales}
              defaultContentLocale={defaultContentLocale}
              adminConfig={adminConfig}
              doc={
                currentDocument == null
                  ? undefined
                  : (currentDocument as unknown as SingletonPreviewDocument)
              }
            />
          </div>
        </Container>
      </Section>
      <Section>
        <Container>
          <VersionHistoryCore
            data={data}
            resourceDefinition={singletonDefinition}
            resourcePath={singleton}
            documentId={documentId}
            currentDocument={currentDocument}
            locale={locale}
            rowPresentation={rowPresentation}
            loadHistoricalVersion={async (_path, _documentId, versionId, versionLocale) => {
              const historical = await findSingletonByVersion({
                data: { singleton, versionId, locale: versionLocale },
              })
              if (historical == null) throw new Error('Singleton version not found')
              return historical as unknown as Record<string, unknown>
            }}
            onPageSizeChange={handlePageSizeChange}
            restoreVersion={(versionId) =>
              restoreSingletonVersion({
                data: {
                  expectedRevision: parseDocumentRevision(currentDocument?.revision),
                  singleton,
                  versionId,
                },
              })
            }
            onRestoreComplete={async () => {
              await router.invalidate()
              navigate({
                to: getAdminRoutePath('singletons', '$singleton'),
                params: { singleton },
                search: locale ? { locale } : {},
              })
            }}
          />
        </Container>
      </Section>
    </>
  )
}
