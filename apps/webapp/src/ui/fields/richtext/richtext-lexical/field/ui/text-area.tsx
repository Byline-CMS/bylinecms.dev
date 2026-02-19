'use client'

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { type HTMLInputTypeAttribute, type JSX, useId } from 'react'

import './text-area.css'

type Props = Readonly<{
  'data-test-id'?: string
  label: string
  rows?: number
  onChange: (val: string) => void
  placeholder?: string
  value: string
  type?: HTMLInputTypeAttribute
}>

export function TextArea({
  label,
  onChange,
  rows = 4,
  placeholder = '',
  'data-test-id': dataTestId,
}: Props): JSX.Element {
  const inputId = useId()

  return (
    <div className="TextArea__wrapper">
      <label className="TextArea__label" htmlFor={inputId}>
        {label}
      </label>
      <textarea
        rows={rows}
        id={inputId}
        className="TextArea__input"
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
        }}
        data-test-id={dataTestId}
      />
    </div>
  )
}
