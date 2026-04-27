'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type * as React from 'react'
import { useEffect, useMemo, useState } from 'react'

import type { CollectionDefinition } from '@byline/core'
import { getClientConfig, getCollectionDefinition } from '@byline/core'
import {
  Button,
  Checkbox,
  CloseIcon,
  IconButton,
  Input,
  Label,
  Modal,
  RadioGroup,
  RadioGroupItem,
  Select,
  type SelectValue,
} from '@infonomic/uikit/react'

import { RelationPicker } from '@/ui/fields/relation/relation-picker'
import { validateUrl } from '../../../utils/url'
import type { DocumentRelation } from '../../../nodes/document-relation'
import type { LinkAttributes } from '../../../nodes/link-nodes'
import type { LinkData, LinkModalProps } from './types'

interface FormState {
  text: string
  linkType: 'custom' | 'internal'
  url: string
  newTab: boolean
  /** Which collection the Select is currently previewing — UI state only. */
  targetCollection: string | null
  /** Currently chosen document relation. `targetCollectionPath` is the
   * source-of-truth collection for this doc and is independent of
   * `targetCollection` so the user can explore other collections in the
   * Select without losing their pick. */
  picked: DocumentRelation | null
}

function emptyState(linkable: CollectionDefinition[]): FormState {
  return {
    text: '',
    linkType: linkable.length > 0 ? 'internal' : 'custom',
    url: '',
    newTab: false,
    targetCollection: linkable[0]?.path ?? null,
    picked: null,
  }
}

function fromLinkData(data: LinkData | undefined, linkable: CollectionDefinition[]): FormState {
  const base = emptyState(linkable)
  if (!data) return base
  const fields = data.fields
  if (!fields) return base
  // Default to internal when:
  //   • the stored data already says internal, or
  //   • this is a fresh placeholder link from the toolbar (linkType: 'custom'
  //     with an empty / `https://` url) — in that case the user hasn't
  //     decided yet, so prefer the picker when any collection has
  //     `linksInEditor: true`.
  const url = fields.linkType === 'internal' ? '' : (fields.url ?? '')
  const isPlaceholderUrl = url === '' || url === 'https://'
  const wantsInternal = linkable.length > 0 && (fields.linkType === 'internal' || isPlaceholderUrl)
  const linkType: 'custom' | 'internal' = wantsInternal ? 'internal' : 'custom'
  const picked: DocumentRelation | null =
    fields.linkType === 'internal'
      ? {
        targetDocumentId: fields.targetDocumentId,
        targetCollectionId: fields.targetCollectionId,
        targetCollectionPath: fields.targetCollectionPath,
        document: fields.document,
      }
      : null
  return {
    text: data.text ?? '',
    linkType,
    // Don't surface the placeholder `https://` in the URL input — it makes
    // the field look pre-filled with garbage.
    url: isPlaceholderUrl ? '' : url,
    newTab: fields.newTab ?? false,
    targetCollection: picked?.targetCollectionPath ?? linkable[0]?.path ?? null,
    picked,
  }
}

export const LinkModal: React.FC<LinkModalProps> = ({
  isOpen = false,
  onSubmit,
  onClose,
  data: dataFromProps,
}) => {
  const linkable = useMemo<CollectionDefinition[]>(
    () => getClientConfig().collections.filter((c) => c.linksInEditor === true),
    []
  )

  const [state, setState] = useState<FormState>(() => fromLinkData(dataFromProps, linkable))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)

  // Reset whenever the drawer transitions to open (new link selected).
  useEffect(() => {
    if (isOpen) {
      setState(fromLinkData(dataFromProps, linkable))
      setUrlError(null)
    }
  }, [isOpen, dataFromProps, linkable])

  const targetDef: CollectionDefinition | null = state.targetCollection
    ? getCollectionDefinition(state.targetCollection)
    : null

  const collectionItems: SelectValue<string>[] = useMemo(
    () => linkable.map((c) => ({ label: c.labels.singular, value: c.path })),
    [linkable]
  )

  const pickedLabel: string | null = useMemo(() => {
    if (state.linkType !== 'internal' || !state.picked) return null
    const title = state.picked.document?.title
    if (typeof title === 'string' && title.length > 0) return title
    // No title cached — show a stable stub keyed off the collection.
    const pickedDef = getCollectionDefinition(state.picked.targetCollectionPath)
    const short = state.picked.targetDocumentId.slice(0, 8)
    return `${pickedDef?.labels.singular ?? state.picked.targetCollectionPath} · ${short}…`
  }, [state.linkType, state.picked])

  const handlePickerSelect = (selection: {
    targetDocumentId: string
    targetCollectionId: string
    record?: Record<string, any>
  }) => {
    setPickerOpen(false)
    setState((s) => {
      const targetCollection = s.targetCollection as string
      // Normalise the picked record into a small `{ title, path }` envelope.
      // `useAsTitle` is always in the picker projection; `path` is top-level
      // metadata on every list response. This is everything the public
      // client needs to build a link to the document — no afterRead hook
      // needed for the common case.
      const titleField = getCollectionDefinition(targetCollection)?.useAsTitle
      const title = titleField ? selection.record?.fields?.[titleField] : undefined
      const path = selection.record?.path
      const document: Record<string, any> = {}
      if (typeof title === 'string' && title.length > 0) document.title = title
      if (typeof path === 'string' && path.length > 0) document.path = path
      return {
        ...s,
        picked: {
          targetDocumentId: selection.targetDocumentId,
          targetCollectionId: selection.targetCollectionId,
          targetCollectionPath: targetCollection,
          document: Object.keys(document).length > 0 ? document : undefined,
        },
      }
    })
  }

  const handleSave = () => {
    if (state.linkType === 'custom') {
      const url = state.url
      if (!url.startsWith('/') && !validateUrl(url)) {
        setUrlError('Enter a valid URL or a root-relative path starting with /')
        return
      }
    }
    if (state.linkType === 'internal') {
      if (!state.picked) {
        setUrlError('Pick a target document')
        return
      }
    }

    const picked = state.picked as DocumentRelation
    const fields: LinkAttributes =
      state.linkType === 'custom'
        ? {
          linkType: 'custom',
          url: state.url,
          newTab: state.newTab,
        }
        : {
          linkType: 'internal',
          newTab: state.newTab,
          targetDocumentId: picked.targetDocumentId,
          targetCollectionId: picked.targetCollectionId,
          targetCollectionPath: picked.targetCollectionPath,
          document: picked.document,
        }

    onSubmit({
      text: state.text.length > 0 ? state.text : null,
      fields,
    })
    onClose()
  }

  if (!isOpen) return null

  return (
    <>
      <Modal isOpen={isOpen} onDismiss={onClose} closeOnOverlayClick={false}>
        <Modal.Container style={{ maxWidth: '480px', width: '100%' }}>
          <Modal.Header className="flex items-center justify-between pt-4 mb-4">
            <h3 className="m-0 text-xl">Edit link</h3>
            <IconButton aria-label="Close" size="xs" onClick={onClose}>
              <CloseIcon width="15px" height="15px" svgClassName="white-icon" />
            </IconButton>
          </Modal.Header>
          <Modal.Content>
            <div className="flex flex-col gap-4">
              <Input
                id="link-text"
                className="mb-2"
                name="text"
                label="Link text"
                placeholder="Visible link text"
                value={state.text}
                onChange={(e) => setState((s) => ({ ...s, text: e.target.value }))}
              />

              {linkable.length > 0 && (
                <RadioGroup

                  id="link-type"
                  name="linkType"
                  aria-label="Link type"
                  direction="row"
                  value={state.linkType}
                  onValueChange={(value) =>
                    setState((s) => ({
                      ...s,
                      linkType: value === 'internal' ? 'internal' : 'custom',
                    }))
                  }
                >
                  <RadioGroupItem id="link-type-internal" value="internal" label="Document" />
                  <RadioGroupItem id="link-type-custom" value="custom" label="Custom URL" />
                </RadioGroup>
              )}

              {state.linkType === 'custom' && (
                <Input
                  id="link-url"
                  name="url"
                  label="URL"
                  placeholder="https://example.com or /path"
                  value={state.url}
                  errorText={urlError ?? undefined}
                  error={urlError != null}
                  onChange={(e) => {
                    setUrlError(null)
                    setState((s) => ({ ...s, url: e.target.value }))
                  }}
                />
              )}

              {state.linkType === 'internal' && (
                <div className="flex flex-col gap-3 mt-2">
                  {linkable.length > 1 && (
                    <div>
                      <Label id="link-target-collection" htmlFor="link-target-collection" className="mb-1" label="Target collection" />
                      <Select<string>
                        size="sm"
                        items={collectionItems}
                        placeholder="Target collection"
                        value={state.targetCollection ?? undefined}
                        onValueChange={(value) => {
                          if (value == null) return
                          // Switching the Select is exploratory — we keep the
                          // currently picked document; only the picker target
                          // changes. Picking a new document via the picker is
                          // the only path that replaces `picked`.
                          setState((s) => ({ ...s, targetCollection: value }))
                        }}
                      />
                    </div>
                  )}

                  <div className="border rounded p-3">
                    <Label id="link-target-document" htmlFor="link-target-document" className="mb-1" label="Target document" />

                    <div className="flex items-center justify-between gap-2">
                      {pickedLabel && (
                        <span className="text-sm text-accent-400 truncate">{pickedLabel}</span>
                      )}
                      <Button
                        size="sm"
                        variant="outlined"
                        intent="noeffect"
                        type="button"
                        onClick={() => setPickerOpen(true)}
                        disabled={!state.targetCollection}
                      >
                        {pickedLabel
                          ? 'Change'
                          : `Pick ${targetDef?.labels.singular ?? 'document'}…`}
                      </Button>
                    </div>
                  </div>

                  {urlError && state.linkType === 'internal' && (
                    <span className="text-xs text-red-400">{urlError}</span>
                  )}
                </div>
              )}

              <Checkbox
                id="link-new-tab"
                name="newTab"
                label="Open in new tab"
                checked={state.newTab}
                onCheckedChange={(checked) => setState((s) => ({ ...s, newTab: checked === true }))}
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

      {state.linkType === 'internal' && state.targetCollection && (
        <RelationPicker
          targetCollectionPath={state.targetCollection}
          targetDefinition={targetDef}
          isOpen={pickerOpen}
          onSelect={handlePickerSelect}
          onDismiss={() => setPickerOpen(false)}
        />
      )}
    </>
  )
}
