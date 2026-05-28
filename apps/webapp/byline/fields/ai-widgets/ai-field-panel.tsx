/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useCallback } from 'react'

import { useFormContext } from '@byline/admin/react'
import { AiPluginText } from '@byline/ai/plugins/text'
import type { FieldAdornmentSlotProps } from '@byline/core'

import { useAiPanelOpen } from './ai-panel-store.js'

/**
 * `afterField` slot for AI-enabled text fields. Renders `<AiPluginText>`
 * controlled by the per-path store, reads the current value from form
 * context, and dispatches a value update via `setFieldValue` when the
 * AI returns a result.
 */
export function AiFieldPanel({ path, value }: FieldAdornmentSlotProps): React.JSX.Element {
  const { setFieldValue } = useFormContext()
  const [open, setOpen] = useAiPanelOpen(path)

  const handleApply = useCallback(
    (nextText: string) => {
      setFieldValue(path, nextText)
    },
    [path, setFieldValue]
  )

  return (
    <AiPluginText
      inputText={typeof value === 'string' ? value : ''}
      onApplyResult={handleApply}
      open={open}
      onOpenChange={setOpen}
    />
  )
}
