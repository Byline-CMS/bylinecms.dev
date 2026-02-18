'use client'

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

/**
 * Portions Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license found in the LICENSE file in the root directory of this source tree.
 *
 * Portions Copyright (c) Payload CMS, LLC info@payloadcms.com
 * Licensed under the MIT license found in the LICENSE file in the root directory of this source tree.
 *
 * Debounce strategy adapted from
 * https://github.com/payloadcms/payload/tree/main/packages/richtext-lexical
 */

import type React from 'react'
import { memo, useCallback, useMemo, useRef } from 'react'

import { HelpText, Label } from '@infonomic/uikit/react'
import type { EditorState, SerializedEditorState } from 'lexical'
import { ErrorBoundary } from 'react-error-boundary'

import { richTextValidate } from '../validate/validate'
import { ApplyValuePlugin } from './apply-value-plugin'
import { EditorContext } from './editor-context'
import { hashSerializedState } from './utils/hashSerializedState'
import type { EditorFieldProps } from '../types'

import './editor-component.css'
import './themes/lexical-editor-theme.css'

const baseClass = 'lexicalRichTextEditor'

// NOTE: @See ./editor-component.md mini doc for an explanation of our editor architecture.

// We memoize the EditorComponent to prevent re-renders from parent components or
// other editor instances. Only internal state changes for a given (this)
// editor instance should trigger re-renders. Our form-context and value handlers
// are subscription-based and so in theory this shouldn't be necessary, but
// here just in case.
export const EditorComponent = memo(function EditorComponent({
  name,
  id,
  label,
  description,
  required,
  readonly,
  editorConfig,
  defaultValue,
  value,
  onChange,
  validate = richTextValidate,
  onError: _onError,
  lexicalEditorProps: _lexicalEditorProps,
}: EditorFieldProps): React.JSX.Element {
  const disabled = readonly ?? false
  const dispatchFieldUpdateTask = useRef<number>(undefined)
  const valueRef = useRef(value)
  valueRef.current = value
  const initialValueRef = useRef(defaultValue)
  initialValueRef.current = defaultValue
  const lastEmittedHashRef = useRef<string | undefined>(undefined)
  const normalizedIncomingHashRef = useRef<string | undefined>(undefined)
  const hasNormalizedBaselineRef = useRef<boolean>(false)
  // const _debugLogCountRef = useRef<number>(0)

  // TODO: implement validation handling (currently unused)
  const _memoizedValidate = useCallback(
    (val: SerializedEditorState | undefined) => {
      if (typeof validate === 'function') {
        return validate(val, { required })
      }
      return true
    },
    [validate, required]
  )

  // Debounced onChange -> emit to store
  const handleChange = useCallback(
    (editorState: EditorState, _editor: unknown, _tags?: Set<string>) => {
      // const _capturedTags = tags != null ? Array.from(tags) : []
      const updateFieldValue = (editorState: EditorState) => {
        const newState = editorState.toJSON()
        const nextHash = hashSerializedState(newState)

        // If we have an incoming form value but haven't established a normalized baseline yet,
        // ignore mount-time normalization updates (often appear as tags: []).
        if (
          (valueRef.current ?? initialValueRef.current) != null &&
          hasNormalizedBaselineRef.current !== true
        ) {
          // if (process.env.NODE_ENV === 'production' && _debugLogCountRef.current < 10) {
          //   _debugLogCountRef.current++
          //   // eslint-disable-next-line no-console
          //   console.log('[lexical][payload][skip] waiting baseline', {
          //     tags: _capturedTags,
          //     nextHash,
          //     normalizedIncomingHash: normalizedIncomingHashRef.current,
          //     lastEmittedHash: lastEmittedHashRef.current,
          //   })
          // }
          return
        }
        // Prefer comparing against Lexical-normalized incoming JSON (critical for nested editors).
        if (
          normalizedIncomingHashRef.current != null &&
          nextHash === normalizedIncomingHashRef.current
        ) {
          return
        }

        // Also avoid re-emitting the exact same state multiple times.
        if (lastEmittedHashRef.current != null && nextHash === lastEmittedHashRef.current) return

        lastEmittedHashRef.current = nextHash

        // if (process.env.NODE_ENV === 'production' && _debugLogCountRef.current < 10) {
        //   _debugLogCountRef.current++
        //   // eslint-disable-next-line no-console
        //   console.log('[lexical][payload][setValue]', {
        //     tags: _capturedTags,
        //     nextHash,
        //     normalizedIncomingHash: normalizedIncomingHashRef.current,
        //     rawIncomingHash: rawIncomingHashRef.current,
        //     lastEmittedHash: lastEmittedHashRef.current,
        //   })
        // }

        if (typeof onChange === 'function') {
          onChange(newState)
        }
      }

      if (typeof window.requestIdleCallback === 'function') {
        // Cancel earlier scheduled value updates,
        // so that a CPU-limited event loop isn't flooded with n callbacks for n keystrokes
        // into the rich text field, but that there's only ever the latest one state update
        // dispatch task, to be executed with the next idle time,
        // or the deadline of 500ms.
        if (typeof window.cancelIdleCallback === 'function' && dispatchFieldUpdateTask.current) {
          cancelIdleCallback(dispatchFieldUpdateTask.current)
        }
        // Schedule the state update to happen the next time the browser has sufficient resources,
        // or the latest after 500ms.
        dispatchFieldUpdateTask.current = requestIdleCallback(() => updateFieldValue(editorState), {
          timeout: 500,
        })
      } else {
        updateFieldValue(editorState)
      }
    },
    [onChange]
  )

  const incomingValue = value ?? defaultValue ?? undefined

  const incomingHash = useMemo(
    () => (incomingValue != null ? hashSerializedState(incomingValue) : undefined),
    [incomingValue]
  )

  return (
    <div className={baseClass}>
      <div className={`${baseClass}__wrap`}>
        {label && <Label id="label" label={label} htmlFor={id} required={required} />}
        <ErrorBoundary fallbackRender={fallbackRender} onReset={() => {}}>
          <EditorContext
            composerKey={id}
            editorConfig={editorConfig}
            key={id}
            onChange={handleChange}
            readOnly={disabled}
            value={incomingValue}
          >
            <ApplyValuePlugin
              value={incomingValue}
              incomingHash={incomingHash}
              lastEmittedHashRef={lastEmittedHashRef}
              normalizedIncomingHashRef={normalizedIncomingHashRef}
              hasNormalizedBaselineRef={hasNormalizedBaselineRef}
            />
          </EditorContext>
        </ErrorBoundary>
        {description && <HelpText text={description} />}
      </div>
    </div>
  )
})

function fallbackRender({ error }: any): React.JSX.Element {
  return (
    <div className="errorBoundary" role="alert">
      <p>Something went wrong:</p>
      <pre style={{ color: 'red' }}>{error.message}</pre>
    </div>
  )
}
