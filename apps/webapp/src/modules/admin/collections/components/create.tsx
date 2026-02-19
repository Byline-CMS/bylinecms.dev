/**
 * Byline CMS
 *
 * Copyright © 2025 Anthony Bouch and contributors.
 *
 * This file is part of Byline CMS.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import type { CollectionAdminConfig, CollectionDefinition } from '@byline/core'
import { Container, Section, Toast } from '@infonomic/uikit/react'

import { FormRenderer } from '@/ui/fields/form-renderer'
import { createCollectionDocument } from '../data'

type CreateState = {
  status: 'success' | 'failed' | 'busy' | 'idle'
  message: string
}

export const CreateView = ({
  collectionDefinition,
  adminConfig,
  initialData,
}: {
  collectionDefinition: CollectionDefinition
  adminConfig?: CollectionAdminConfig
  initialData?: Record<string, any>
}) => {
  const [toast, setToast] = useState(false)
  const [createState, setCreateState] = useState<CreateState>({
    status: 'idle',
    message: '',
  })
  const navigate = useNavigate()
  const { labels, path, fields } = collectionDefinition
  // const location = useRouterState({ select: (s) => s.location })

  const handleSubmit = async ({ data }: { data: any }) => {
    try {
      await createCollectionDocument(path, data)
      navigate({
        to: '/admin/collections/$collection',
        params: { collection: path },
        search: { action: 'created' },
      })
    } catch (err) {
      console.error(err)
      setCreateState({
        status: 'failed',
        message: `An error occurred while creating ${labels.singular.toLowerCase()}`,
      })
      setToast(true)
    }
  }

  return (
    <>
      <Section>
        <Container>
          <h2 className="mb-2">Create {labels.singular}</h2>
          <FormRenderer
            fields={fields}
            onSubmit={handleSubmit}
            onCancel={() =>
              navigate({
                to: '/admin/collections/$collection',
                params: { collection: path },
              })
            }
            initialData={initialData}
            adminConfig={adminConfig}
          />
        </Container>
      </Section>
      <Toast
        title={`${labels.singular} Creation`}
        iconType={createState.status === 'success' ? 'success' : 'danger'}
        intent={createState.status === 'success' ? 'success' : 'danger'}
        position="bottom-right"
        message={createState.message}
        open={toast}
        onOpenChange={setToast}
      />
    </>
  )
}
