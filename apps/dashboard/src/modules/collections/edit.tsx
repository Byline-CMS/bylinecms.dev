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

import type { CollectionDefinition } from '@byline/core'
import type { AnyCollectionSchemaTypes } from '@byline/core/zod-schemas'
import { Button, Container, HistoryIcon, IconButton, Section, Toast } from '@byline/uikit/react'

import { FormRenderer } from '@/ui/fields/form-renderer'

type EditState = {
  status: 'success' | 'failed' | 'busy' | 'idle'
  message: string
}

export const EditView = ({
  collectionDefinition,
  initialData,
}: {
  collectionDefinition: CollectionDefinition
  initialData: AnyCollectionSchemaTypes['UpdateType']
}) => {
  const [toast, setToast] = useState(false)
  const [editState, setEditState] = useState<EditState>({
    status: 'idle',
    message: '',
  })
  const navigate = useNavigate()
  const { labels, path, fields } = collectionDefinition

  const handleSubmit = async (data: any) => {
    try {
      const response = await fetch(`http://localhost:3001/api/${path}/${initialData.document_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        const error = await response.json()
        console.error('Failed to update page:', error)
        setEditState({
          status: 'failed',
          message: `Failed to update ${labels.singular.toLowerCase()}`,
        })
      } else {
        setEditState({
          status: 'success',
          message: `Successfully updated ${labels.singular.toLowerCase()}`,
        })
      }
    } catch (err) {
      console.error('Network error:', err)
      setEditState({
        status: 'failed',
        message: `An error occurred while updating ${labels.singular.toLowerCase()}`,
      })
    }
    setToast(true)
  }

  return (
    <>
      <Section>
        <Container>
          <div className="item-view flex flex-col sm:flex-row justify-start sm:justify-between">
            <h2 className="mb-2">Edit {labels.singular}</h2>
            <div className="flex items-center gap-2">
              <IconButton
                className="min-w-[24px] min-h-[24px]"
                size="sm"
                variant="text"
                onClick={() =>
                  navigate({
                    to: '/collections/$collection/$id/history',
                    params: { collection: path, id: String(initialData.document_id) },
                  })
                }
              >
                <HistoryIcon className="w-4 h-4" />
              </IconButton>
              <Button
                size="sm"
                variant="filled"
                className="min-w-[50px] min-h-[28px]"
                onClick={() =>
                  navigate({
                    to: '/collections/$collection/$id',
                    params: { collection: path, id: String(initialData.document_id) },
                  })
                }
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="outlined"
                className="min-w-[50px] min-h-[28px]"
                onClick={() =>
                  navigate({
                    to: '/collections/$collection/$id/api',
                    params: { collection: path, id: String(initialData.document_id) },
                  })
                }
              >
                API
              </Button>
            </div>
          </div>
          <FormRenderer
            fields={fields}
            onSubmit={handleSubmit}
            initialData={initialData}
            onCancel={() =>
              navigate({ to: '/collections/$collection', params: { collection: path } })
            }
          />
        </Container>
      </Section>
      <Toast
        title={`${labels.singular} Update`}
        iconType={editState.status === 'success' ? 'success' : 'danger'}
        intent={editState.status === 'success' ? 'success' : 'danger'}
        position="bottom-right"
        message={editState.message}
        open={toast}
        onOpenChange={setToast}
      />
    </>
  )
}
