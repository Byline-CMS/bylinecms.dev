'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type * as React from 'react'
import { useMemo, useState } from 'react'

import type { CollectionDefinition, StoredFileValue } from '@byline/core'
import { getCollectionDefinition } from '@byline/core'
import { RelationPicker } from '@byline/ui'
import {
  Button,
  Checkbox,
  CloseIcon,
  ErrorText,
  IconButton,
  Input,
  Label,
  Modal,
  RadioGroup,
  RadioGroupItem,
} from '@infonomic/uikit/react'

import { useModalFormState } from '../../shared/useModalFormState'
import { isAltTextValid, positionOptions } from './fields'
import { deriveImageSizes, getPreferredSize } from './utils'
import type { DocumentRelation } from '../../nodes/document-relation'
import type { Position } from '../../nodes/inline-image-node/types'
import type { InlineImageData, InlineImageModalProps } from './types'

interface FormState {
  documentRelation: DocumentRelation | null
  altText: string
  position: Position
  showCaption: boolean
}

function emptyState(): FormState {
  return {
    documentRelation: null,
    altText: '',
    position: 'full',
    showCaption: false,
  }
}

function fromInlineImageData(data: InlineImageData | undefined): FormState {
  if (!data) return emptyState()
  return {
    documentRelation: data.documentRelation ?? null,
    altText: data.altText ?? '',
    position: data.position ?? 'full',
    showCaption: data.showCaption ?? false,
  }
}

export const InlineImageModal: React.FC<InlineImageModalProps> = ({
  isOpen,
  collection,
  data: dataFromProps,
  onSubmit,
  onClose,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [altError, setAltError] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)

  const [state, setState] = useModalFormState<FormState>(
    isOpen,
    () => fromInlineImageData(dataFromProps),
    () => {
      setAltError(null)
      setImageError(null)
    }
  )

  const targetDef: CollectionDefinition | null = getCollectionDefinition(collection)

  // The image StoredFileValue lives inside the picked media doc's denormalised
  // `documentRelation.document.image` field — see `handlePickerSelect` below.
  const pickedImage: StoredFileValue | null = useMemo(() => {
    const img = state.documentRelation?.document?.image as StoredFileValue | undefined
    return img ?? null
  }, [state.documentRelation])

  const pickedThumbUrl: string | null = useMemo(() => {
    if (!pickedImage?.storageUrl) return null
    if (pickedImage.mimeType === 'image/svg+xml') return pickedImage.storageUrl
    if (pickedImage.thumbnailGenerated) {
      return pickedImage.storageUrl.replace(/\.[^.]+$/, '-thumbnail.webp')
    }
    return pickedImage.storageUrl
  }, [pickedImage])

  const pickedTitle: string | null = useMemo(() => {
    const title = state.documentRelation?.document?.title
    return typeof title === 'string' && title.length > 0 ? title : null
  }, [state.documentRelation])

  const handlePickerSelect = (selection: {
    targetDocumentId: string
    targetCollectionId: string
    record?: Record<string, any>
  }) => {
    setPickerOpen(false)
    const fields = selection.record?.fields ?? {}
    const image = fields.image as StoredFileValue | undefined
    const title = typeof fields.title === 'string' ? fields.title : undefined
    const altTextFromMedia = typeof fields.altText === 'string' ? fields.altText : undefined
    const sizes = image ? deriveImageSizes(image) : []

    setState((s) => {
      const document: Record<string, any> = {}
      if (title) document.title = title
      if (altTextFromMedia) document.altText = altTextFromMedia
      if (image) document.image = image
      if (sizes.length > 0) document.sizes = sizes

      return {
        ...s,
        documentRelation: {
          targetDocumentId: selection.targetDocumentId,
          targetCollectionId: selection.targetCollectionId,
          targetCollectionPath: collection,
          document: Object.keys(document).length > 0 ? document : undefined,
        },
        // Pre-fill alt-text from the media's `altText` field on first pick if
        // the form's alt-text is still empty. Editorial wins over the source
        // record once the user starts typing.
        altText: s.altText.length > 0 ? s.altText : (altTextFromMedia ?? ''),
      }
    })
    setImageError(null)
  }

  const handleSave = () => {
    if (!state.documentRelation || !pickedImage) {
      setImageError('Pick an image')
      return
    }
    if (!isAltTextValid(state.altText)) {
      setAltError('Alt text is required')
      return
    }

    const preferred = getPreferredSize(state.position, pickedImage)
    const data: InlineImageData = {
      documentRelation: state.documentRelation,
      src: preferred?.url ?? pickedImage.storageUrl ?? '',
      altText: state.altText.trim(),
      position: state.position,
      width: preferred?.width,
      height: preferred?.height,
      showCaption: state.showCaption,
    }
    onSubmit(data)
    onClose()
  }

  if (!isOpen) return null

  return (
    <>
      <Modal isOpen={isOpen} onDismiss={onClose} closeOnOverlayClick={false}>
        <Modal.Container style={{ maxWidth: '520px', width: '100%' }}>
          <Modal.Header className="flex items-center justify-between pt-4 mb-2">
            <h3 className="m-0 text-xl">Inline image</h3>
            <IconButton aria-label="Close" size="xs" onClick={onClose}>
              <CloseIcon width="15px" height="15px" svgClassName="white-icon" />
            </IconButton>
          </Modal.Header>
          <Modal.Content>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Image</span>
                <div className="flex items-center gap-3">
                  {pickedThumbUrl ? (
                    <img
                      src={pickedThumbUrl}
                      alt={pickedTitle ?? ''}
                      className="w-18 h-18 object-cover rounded border border-gray-700"
                    />
                  ) : (
                    <div className="w-18 h-18 flex items-center justify-center bg-gray-800 rounded border border-gray-700 text-xs text-gray-500">
                      —
                    </div>
                  )}
                  <Button
                    size="sm"
                    className="min-w-[70px]"
                    variant="outlined"
                    intent="noeffect"
                    type="button"
                    onClick={() => setPickerOpen(true)}
                  >
                    {state.documentRelation
                      ? 'Change image…'
                      : `Pick ${targetDef?.labels.singular ?? 'image'}…`}
                  </Button>
                  {pickedTitle && (
                    <span className="text-sm text-gray-200 truncate">{pickedTitle}</span>
                  )}
                </div>
                {imageError && <ErrorText id="image-error" text={imageError} />}
              </div>

              <Input
                id="inline-image-alt"
                name="altText"
                label="Alt text"
                required
                placeholder="Describe the image for screen readers"
                value={state.altText}
                error={altError != null}
                errorText={altError ?? undefined}
                onChange={(e) => {
                  setAltError(null)
                  setState((s) => ({ ...s, altText: e.target.value }))
                }}
              />

              <div className="flex flex-col gap-2 mb-3">
                <Label
                  htmlFor="inline-image-position"
                  id="inline-image-position-label"
                  className="text-sm font-medium"
                  label="Position"
                />
                <RadioGroup
                  id="inline-image-position"
                  name="position"
                  aria-labelledby="inline-image-position-label"
                  direction="row"
                  value={state.position ?? 'full'}
                  onValueChange={(value) =>
                    setState((s) => ({ ...s, position: value as Position }))
                  }
                >
                  {positionOptions.map((opt) => (
                    <RadioGroupItem
                      key={String(opt.value)}
                      id={`inline-image-position-${opt.value}`}
                      value={String(opt.value)}
                      label={opt.label}
                    />
                  ))}
                </RadioGroup>
              </div>

              <Checkbox
                id="inline-image-caption"
                name="showCaption"
                label="Show caption"
                checked={state.showCaption}
                onCheckedChange={(checked) =>
                  setState((s) => ({ ...s, showCaption: checked === true }))
                }
              />
            </div>
          </Modal.Content>
          <Modal.Actions className="flex gap-3">
            <Button
              size="sm"
              intent="noeffect"
              type="button"
              onClick={onClose}
              className="min-w-[70px]"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              intent="primary"
              type="button"
              onClick={handleSave}
              className="min-w-[70px]"
            >
              Save
            </Button>
          </Modal.Actions>
        </Modal.Container>
      </Modal>

      <RelationPicker
        targetCollectionPath={collection}
        targetDefinition={targetDef}
        isOpen={pickerOpen}
        onSelect={handlePickerSelect}
        onDismiss={() => setPickerOpen(false)}
      />
    </>
  )
}
