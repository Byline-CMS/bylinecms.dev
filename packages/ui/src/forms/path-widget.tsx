/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useCallback, useMemo } from 'react'

import { slugify } from '@byline/core'
import { Input, Label } from '@infonomic/uikit/react'

import { useFieldValue, useFormContext, useSystemPath } from './form-context'

/**
 * Coerce an arbitrary source-field value (string, Date, or other) into
 * a string suitable for slugification. Mirrors the lifecycle's coercion
 * so the live preview matches what the server will store.
 */
function coerceToString(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export interface PathWidgetProps {
  /** The collection's `useAsPath` source field name, when configured. */
  useAsPath: string | undefined
  /** Collection path, forwarded to the slugifier as context. */
  collectionPath: string
  /** Default content locale, forwarded to the slugifier as context. */
  defaultLocale: string
  /** `'create'` shows the live derived preview as placeholder text. */
  mode: 'create' | 'edit'
}

/**
 * System-managed `documentVersions.path` widget.
 *
 * Displays the current persisted/overridden path as an editable input.
 * In create mode, when the user hasn't supplied an override, the input
 * shows the live-derived preview (slugified `useAsPath` source field) as
 * a placeholder so the user sees what will be saved. The "Regenerate"
 * action explicitly writes the current live preview into the override
 * slot so the user can re-anchor a path against the source field after
 * editing the title.
 */
export const PathWidget = ({ useAsPath, collectionPath, defaultLocale, mode }: PathWidgetProps) => {
  const { setSystemPath } = useFormContext()
  const systemPath = useSystemPath()
  const sourceValue = useFieldValue<unknown>(useAsPath ?? '')

  // Live preview — what the server would derive from the current source
  // field value if no override were set. Used as placeholder in create
  // mode and as the target of the "Regenerate" action.
  const livePreview = useMemo(() => {
    if (!useAsPath) return ''
    const asString = coerceToString(sourceValue)
    if (asString.length === 0) return ''
    return slugify(asString, { locale: defaultLocale, collectionPath })
  }, [useAsPath, sourceValue, defaultLocale, collectionPath])

  const inputValue = systemPath ?? ''

  const handleChange = useCallback(
    (next: string) => {
      // Empty string clears the override — server falls back to derive
      // (create) or sticky (update).
      setSystemPath(next.length === 0 ? null : next)
    },
    [setSystemPath]
  )

  const handleRegenerate = useCallback(() => {
    if (livePreview.length > 0) {
      setSystemPath(livePreview)
    }
  }, [livePreview, setSystemPath])

  // Validate live: if the typed value differs from its slugified form,
  // surface an inline hint without blocking input (mirrors the previous
  // field-hook advisory behaviour).
  const formatted = useMemo(() => {
    if (inputValue.length === 0) return ''
    return slugify(inputValue, { locale: defaultLocale, collectionPath })
  }, [inputValue, defaultLocale, collectionPath])

  const hint =
    inputValue.length > 0 && formatted !== inputValue ? `Suggested: "${formatted}"` : undefined

  const placeholder =
    mode === 'create' && livePreview.length > 0 ? `Will be saved as "${livePreview}"` : undefined

  // Screen-reader description. The input's base purpose ("System-managed
  // URL path") plus whichever of the visible hints (placeholder preview
  // in create mode, "Suggested" validation hint) currently applies. The
  // visible helpText/placeholder cover sighted users; this element makes
  // the same information addressable via aria-describedby for AT.
  const srDescription = ['System-managed URL path for this document.', placeholder, hint]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="byline-path">
      <div className="flex items-center justify-between gap-2">
        <Label id="system-path-label" htmlFor="system-path" label="Path" />
        {useAsPath && livePreview.length > 0 && livePreview !== systemPath && (
          <button
            type="button"
            onClick={handleRegenerate}
            className="text-[0.8rem] underline"
            aria-label={`Regenerate path from ${useAsPath} field`}
          >
            Regenerate from {useAsPath}
          </button>
        )}
      </div>
      <Input
        id="system-path"
        name="__systemPath__"
        value={inputValue}
        placeholder={placeholder}
        onChange={(e) => handleChange(e.target.value)}
        helpText={hint}
        aria-describedby="system-path-description"
      />
      <span id="system-path-description" className="sr-only">
        {srDescription}
      </span>
    </div>
  )
}
