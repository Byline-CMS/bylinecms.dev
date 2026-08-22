'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useState } from 'react'
import { useRouterState } from '@tanstack/react-router'

import { useTranslation } from '@byline/i18n/react'
import {
  Alert,
  Button,
  Container,
  Input,
  Section,
  Select,
  Table,
  useToastManager,
} from '@byline/ui/react'
import cx from 'clsx'

import { getAdminRoutePath } from '../../routes/admin-path.js'
import { cancelCollectionDocumentScheduledPublish } from '../../server-fns/collections/index.js'
import { Link, useNavigate } from '../chrome/loose-router.js'
import { RouterPager } from '../chrome/router-pager.js'
import styles from './list.module.css'
import type { ScheduledPublicationListResponse } from '../../server-fns/collections/index.js'

export function ScheduledPublicationsView({ data }: { data: ScheduledPublicationListResponse }) {
  const { t } = useTranslation('byline-admin')
  const navigate = useNavigate()
  const toastManager = useToastManager()
  const location = useRouterState({ select: (state) => state.location })
  const search = location.search as {
    state?: 'armed' | 'needs_reconfirm'
    lastAuthorizedBy?: string
    page?: number
  }
  const [authorizer, setAuthorizer] = useState(search.lastAuthorizedBy ?? '')
  const [cancelling, setCancelling] = useState<string | null>(null)

  const applySearch = (patch: Record<string, unknown>) => {
    navigate({
      to: getAdminRoutePath('scheduled-publications'),
      search: { ...(location.search as Record<string, unknown>), ...patch, page: undefined },
    })
  }

  const cancel = async (collection: string, documentId: string) => {
    setCancelling(documentId)
    try {
      const result = await cancelCollectionDocumentScheduledPublish({
        data: { collection, id: documentId },
      })
      const cancelled = result.status === 'cancelled'
      toastManager.add({
        title: cancelled
          ? t('scheduledPublication.toast.cancelledTitle')
          : t('scheduledPublication.toast.cancelLostTitle'),
        description: cancelled
          ? t('scheduledPublication.toast.cancelledDescription')
          : t('scheduledPublication.toast.cancelLostDescription'),
        data: {
          intent: cancelled ? 'success' : 'warning',
          iconType: cancelled ? 'success' : 'warning',
          icon: true,
          close: true,
        },
      })
      navigate({
        to: getAdminRoutePath('scheduled-publications'),
        search: location.search as Record<string, unknown>,
      })
    } catch (error) {
      toastManager.add({
        title: t('scheduledPublication.toast.failedTitle'),
        description: (error as Error).message,
        data: { intent: 'danger', iconType: 'danger', icon: true, close: true },
      })
    } finally {
      setCancelling(null)
    }
  }

  const unhealthy = data.runtime.health?.status !== 'healthy'

  return (
    <Section>
      <Container>
        <div className={cx('byline-scheduled-list-head', styles.head)}>
          <h1 className={styles.title}>{t('scheduledPublication.list.title')}</h1>
          <p className={styles.intro}>{t('scheduledPublication.list.intro')}</p>
        </div>

        {unhealthy && (
          <Alert
            className={styles.health}
            intent="warning"
            icon={true}
            close={false}
            title={t('scheduledPublication.list.schedulerWarningTitle')}
          >
            {t('scheduledPublication.list.schedulerWarningBody', {
              status: data.runtime.health?.status ?? 'not_started',
            })}
          </Alert>
        )}

        <div className={styles.filters}>
          <Select<string>
            id="scheduled-publication-state"
            name="scheduled-publication-state"
            size="sm"
            value={search.state ?? '_all'}
            items={[
              { value: '_all', label: t('scheduledPublication.list.filters.allStates') },
              { value: 'armed', label: t('scheduledPublication.list.states.armed') },
              {
                value: 'needs_reconfirm',
                label: t('scheduledPublication.list.states.needsReconfirm'),
              },
            ]}
            onValueChange={(value) => applySearch({ state: value === '_all' ? undefined : value })}
          />
          <Input
            id="scheduled-publication-authorizer"
            name="scheduled-publication-authorizer"
            inputSize="sm"
            label={t('scheduledPublication.list.filters.authorizer')}
            value={authorizer}
            onChange={(event) => setAuthorizer(event.currentTarget.value)}
          />
          <Button
            size="sm"
            type="button"
            onClick={() => applySearch({ lastAuthorizedBy: authorizer.trim() || undefined })}
          >
            {t('scheduledPublication.list.filters.apply')}
          </Button>
          {(search.state != null || search.lastAuthorizedBy != null) && (
            <Button
              size="sm"
              type="button"
              variant="text"
              onClick={() => {
                setAuthorizer('')
                navigate({ to: getAdminRoutePath('scheduled-publications'), search: {} })
              }}
            >
              {t('scheduledPublication.list.filters.clear')}
            </Button>
          )}
          <RouterPager
            page={data.meta.page}
            count={data.meta.totalPages}
            showFirstButton
            showLastButton
            componentName="scheduledPublicationsPagerTop"
            aria-label={t('scheduledPublication.list.pagerAriaLabel')}
          />
        </div>

        {data.schedules.length === 0 ? (
          <p className={styles.empty}>{t('scheduledPublication.list.empty')}</p>
        ) : (
          <Table.Container className={styles.tableWrap}>
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeadingCell scope="col">
                    {t('scheduledPublication.list.columns.document')}
                  </Table.HeadingCell>
                  <Table.HeadingCell scope="col">
                    {t('scheduledPublication.list.columns.publishAt')}
                  </Table.HeadingCell>
                  <Table.HeadingCell scope="col">
                    {t('scheduledPublication.list.columns.state')}
                  </Table.HeadingCell>
                  <Table.HeadingCell scope="col">
                    {t('scheduledPublication.list.columns.authorizer')}
                  </Table.HeadingCell>
                  <Table.HeadingCell scope="col">
                    {t('scheduledPublication.list.columns.attempt')}
                  </Table.HeadingCell>
                  <Table.HeadingCell scope="col">
                    {t('scheduledPublication.list.columns.actions')}
                  </Table.HeadingCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {data.schedules.map((schedule) => {
                  const overdue =
                    schedule.state === 'armed' &&
                    new Date(schedule.publishAt).getTime() <= Date.now()
                  return (
                    <Table.Row key={schedule.documentId}>
                      <Table.Cell>
                        <Link
                          to={getAdminRoutePath('collections', '$collection', '$id')}
                          params={{
                            collection: schedule.collectionPath,
                            id: schedule.documentId,
                          }}
                        >
                          {schedule.documentPath || schedule.documentId}
                        </Link>
                        <span className={styles.collection}>{schedule.collectionLabel}</span>
                      </Table.Cell>
                      <Table.Cell>{new Date(schedule.publishAt).toLocaleString()}</Table.Cell>
                      <Table.Cell>
                        {schedule.state === 'needs_reconfirm'
                          ? t('scheduledPublication.list.states.needsReconfirm')
                          : overdue
                            ? t('scheduledPublication.list.states.overdue')
                            : t('scheduledPublication.list.states.armed')}
                      </Table.Cell>
                      <Table.Cell>{schedule.lastAuthorizedBy ?? '—'}</Table.Cell>
                      <Table.Cell>
                        <span>{schedule.attemptCount}</span>
                        {schedule.lastError != null && (
                          <span className={styles.error}>{schedule.lastError}</span>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <Button
                          size="sm"
                          type="button"
                          variant="text"
                          disabled={cancelling === schedule.documentId}
                          onClick={() => cancel(schedule.collectionPath, schedule.documentId)}
                        >
                          {t('scheduledPublication.actions.cancel')}
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  )
                })}
              </Table.Body>
            </Table>
          </Table.Container>
        )}

        <div className={styles.pagerBottom}>
          <RouterPager
            page={data.meta.page}
            count={data.meta.totalPages}
            showFirstButton
            showLastButton
            componentName="scheduledPublicationsPagerBottom"
            aria-label={t('scheduledPublication.list.pagerAriaLabel')}
          />
        </div>
      </Container>
    </Section>
  )
}
