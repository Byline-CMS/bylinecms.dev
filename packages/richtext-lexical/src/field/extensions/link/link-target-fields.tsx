'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * The "where does this point?" sub-form, shared by the link modal and the
 * inline-image modal.
 *
 * Purely presentational — every decision lives in `link-target-state.ts`,
 * which is where the rules are tested. This file owns the markup, the
 * picker's open/closed state, and nothing else.
 *
 * `idPrefix` is required rather than defaulted: two of these can be
 * mounted in one document (an image modal over a link modal), and
 * duplicate element ids break the `Label`/`htmlFor` association that
 * screen readers depend on.
 */

import type * as React from 'react'
import { useMemo, useState } from 'react'

import { RelationPicker } from '@byline/admin/react'
import type { MultiCollectionDefinition } from '@byline/core'
import { getCollectionDefinition, isSingleton } from '@byline/core'
import {
  Button,
  Checkbox,
  CloseIcon,
  EditIcon,
  IconButton,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  type SelectValue,
} from '@byline/ui/react'

import type { LinkTargetState } from './link-target-state'

import './link-target-fields.css'

export interface LinkTargetFieldsProps {
  idPrefix: string
  state: LinkTargetState
  onChange: (next: LinkTargetState) => void
  /** Collections with `linksInEditor: true`. Empty disables the picker. */
  linkable: MultiCollectionDefinition[]
  /** Offer a "no link" choice. See `LinkTargetOptions.allowNone`. */
  allowNone: boolean
  /** Validation message from `validateLinkTarget`, if the form was submitted. */
  error?: string | null
  /** Label above the kind radio. */
  legend?: string
}

export const LinkTargetFields: React.FC<LinkTargetFieldsProps> = ({
  idPrefix,
  state,
  onChange,
  linkable,
  allowNone,
  error,
  legend = 'Link',
}) => {
  const [pickerOpen, setPickerOpen] = useState(false)

  const targetDefinition = state.targetCollection
    ? getCollectionDefinition(state.targetCollection)
    : null
  const targetDef: MultiCollectionDefinition | null =
    targetDefinition != null && !isSingleton(targetDefinition) ? targetDefinition : null

  const collectionItems: SelectValue<string>[] = useMemo(
    () => linkable.map((c) => ({ label: c.labels.singular, value: c.path })),
    [linkable]
  )

  const pickedLabel: string | null = useMemo(() => {
    if (state.kind !== 'internal' || !state.picked) return null
    const title = state.picked.document?.title
    if (typeof title === 'string' && title.length > 0) return title
    const pickedDefinition = getCollectionDefinition(state.picked.targetCollectionPath)
    const pickedDef =
      pickedDefinition != null && !isSingleton(pickedDefinition) ? pickedDefinition : null
    const short = state.picked.targetDocumentId.slice(0, 8)
    return `${pickedDef?.labels.singular ?? state.picked.targetCollectionPath} · ${short}…`
  }, [state.kind, state.picked])

  const handlePickerSelect = (selection: {
    targetDocumentId: string
    targetCollectionId: string
    record?: Record<string, any>
  }) => {
    setPickerOpen(false)
    const targetCollection = state.targetCollection as string
    // Normalise the picked record into a small `{ title, path }` envelope —
    // everything a renderer needs to build a link without a round-trip.
    // `useAsTitle` is always in the picker projection; `path` is top-level
    // metadata on every list response.
    const titleField = getCollectionDefinition(targetCollection)?.useAsTitle
    const title = titleField ? selection.record?.fields?.[titleField] : undefined
    const path = selection.record?.path
    const document: Record<string, any> = {}
    if (typeof title === 'string' && title.length > 0) document.title = title
    if (typeof path === 'string' && path.length > 0) document.path = path
    onChange({
      ...state,
      picked: {
        targetDocumentId: selection.targetDocumentId,
        targetCollectionId: selection.targetCollectionId,
        targetCollectionPath: targetCollection,
        document: Object.keys(document).length > 0 ? document : undefined,
      },
    })
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <Label
          id={`${idPrefix}-kind-label`}
          htmlFor={`${idPrefix}-kind`}
          className="text-sm font-medium"
          label={legend}
        />
        <RadioGroup
          id={`${idPrefix}-kind`}
          name={`${idPrefix}-kind`}
          aria-labelledby={`${idPrefix}-kind-label`}
          direction="row"
          value={state.kind}
          onValueChange={(value) => onChange({ ...state, kind: value as LinkTargetState['kind'] })}
        >
          {allowNone && (
            <RadioGroupItem id={`${idPrefix}-kind-none`} value="none" label="No link" />
          )}
          {linkable.length > 0 && (
            <RadioGroupItem id={`${idPrefix}-kind-internal`} value="internal" label="Document" />
          )}
          <RadioGroupItem id={`${idPrefix}-kind-custom`} value="custom" label="Custom URL" />
        </RadioGroup>

        {state.kind === 'custom' && (
          <Input
            id={`${idPrefix}-url`}
            name="url"
            label="URL"
            placeholder="https://example.com or /path"
            value={state.url}
            error={error != null}
            errorText={error ?? undefined}
            onChange={(e) => onChange({ ...state, url: e.target.value })}
          />
        )}

        {state.kind === 'internal' && (
          <div className="flex flex-col gap-3">
            {linkable.length > 1 && (
              <div>
                <Label
                  id={`${idPrefix}-collection-label`}
                  htmlFor={`${idPrefix}-collection`}
                  className="mb-1"
                  label="Target collection"
                />
                <Select<string>
                  size="sm"
                  items={collectionItems}
                  placeholder="Target collection"
                  value={state.targetCollection ?? undefined}
                  onValueChange={(value) => {
                    if (value == null) return
                    // Browsing other collections is exploratory — the
                    // current pick survives until the picker replaces it.
                    onChange({ ...state, targetCollection: value })
                  }}
                />
              </div>
            )}

            <div>
              <Label
                id={`${idPrefix}-document-label`}
                htmlFor={`${idPrefix}-document`}
                className="mb-1"
                label="Target document"
              />
              {/*
                Frame → tile → icon actions, matching the admin relation
                field. A chosen document is a summary line with edit and
                remove icons, not a text button whose label changes; an
                empty one is a single outlined select button.
              */}
              <div className="byline-link-target-frame">
                {state.picked ? (
                  <div className="byline-link-target-tile">
                    <span className="byline-link-target-summary">
                      <span className="byline-link-target-kind">
                        {targetDef?.labels.singular ?? state.picked.targetCollectionPath}
                      </span>
                      <span className="byline-link-target-value">{pickedLabel}</span>
                    </span>
                    <span className="byline-link-target-actions">
                      <IconButton
                        id={`${idPrefix}-document`}
                        type="button"
                        intent="noeffect"
                        size="xs"
                        aria-label={`Change ${targetDef?.labels.singular ?? 'document'}`}
                        onClick={() => setPickerOpen(true)}
                        disabled={!state.targetCollection}
                      >
                        <EditIcon width="15px" height="15px" />
                      </IconButton>
                      <IconButton
                        type="button"
                        intent="noeffect"
                        size="xs"
                        aria-label={`Remove ${targetDef?.labels.singular ?? 'document'}`}
                        onClick={() => onChange({ ...state, picked: null })}
                      >
                        <CloseIcon width="15px" height="15px" />
                      </IconButton>
                    </span>
                  </div>
                ) : (
                  <Button
                    id={`${idPrefix}-document`}
                    size="xs"
                    variant="outlined"
                    intent="noeffect"
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    disabled={!state.targetCollection}
                  >
                    {`Select ${targetDef?.labels.singular ?? 'document'}`}
                  </Button>
                )}
              </div>
            </div>

            {error && <span className="text-xs text-red-400">{error}</span>}
          </div>
        )}

        {state.kind !== 'none' && (
          <Checkbox
            id={`${idPrefix}-new-tab`}
            name="newTab"
            label="Open in new tab"
            checked={state.newTab}
            onCheckedChange={(checked) => onChange({ ...state, newTab: checked === true })}
          />
        )}
      </div>

      {state.kind === 'internal' && state.targetCollection && (
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
