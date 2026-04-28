'use client'

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { type HTMLInputTypeAttribute, type JSX, useId } from 'react'

import './input.css'

type Props = Readonly<{
  'data-test-id'?: string
  label: string
  onChange: (val: string) => void
  placeholder?: string
  value: string
  type?: HTMLInputTypeAttribute
}>

export default function TextInput({
  label,
  value,
  onChange,
  placeholder = '',
  'data-test-id': dataTestId,
  type = 'text',
}: Props): JSX.Element {
  const inputId = useId()

  return (
    <div className="Input__wrapper">
      <label className="Input__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        type={type}
        className="Input__input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
        }}
        data-test-id={dataTestId}
      />
    </div>
  )
}
