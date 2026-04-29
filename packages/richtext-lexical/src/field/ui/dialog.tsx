'use client'

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type * as React from 'react'

import './dialog.css'

type Props = Readonly<{
  'data-test-id'?: string
  children: React.ReactNode
}>

export function DialogButtonsList({ children }: Props): React.JSX.Element {
  return <div className="DialogButtonsList">{children}</div>
}

export function DialogActions({ 'data-test-id': dataTestId, children }: Props): React.JSX.Element {
  return (
    <div className="DialogActions" data-test-id={dataTestId}>
      {children}
    </div>
  )
}
