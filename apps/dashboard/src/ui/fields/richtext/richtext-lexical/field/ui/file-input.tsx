/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import * as React from 'react'

import './input.scss'

type Props = Readonly<{
  'data-test-id'?: string
  accept?: string
  label: string
  onChange: (files: FileList | null) => void
}>

export default function FileInput({
  accept,
  label,
  onChange,
  'data-test-id': dataTestId,
}: Props): React.JSX.Element {
  const inputId = React.useId()

  return (
    <div className="Input__wrapper">
      <label className="Input__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        type="file"
        accept={accept}
        className="Input__input"
        onChange={(e) => {
          onChange(e.target.files)
        }}
        data-test-id={dataTestId}
      />
    </div>
  )
}
