/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { FieldLabelSlotProps } from '@byline/core'
import { AiIcon, IconButton, Label } from '@byline/ui/react'

import { useAiPanelOpen } from './ai-panel-store.js'

/**
 * `Label` slot for AI-enabled text fields. Renders the standard label
 * alongside a small icon button that toggles the AI panel rendered by
 * the matching `afterField` slot.
 */
export function AiFieldLabel({
  field,
  path,
  label,
  required,
  id,
}: FieldLabelSlotProps): React.JSX.Element {
  const [open, setOpen] = useAiPanelOpen(path)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
      <Label
        id={`${id}-label`}
        htmlFor={id}
        label={label ?? field.label ?? field.name}
        required={required}
      />
      <IconButton
        size="sm"
        variant="text"
        className="outline-none"
        type="button"
        aria-label={open ? 'Hide AI assistant' : 'Show AI assistant'}
        aria-pressed={open}
        onClick={() => setOpen(!open)}
      >
        <AiIcon />
      </IconButton>
    </span>
  )
}
