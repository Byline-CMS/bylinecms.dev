'use client'

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type * as React from 'react'

import './button.css'

import joinClasses from '../utils/joinClasses'

export function Button({
  'data-test-id': dataTestId,
  children,
  className,
  onClick,
  disabled,
  small,
  title,
}: {
  'data-test-id'?: string
  children: React.ReactNode
  className?: string
  disabled?: boolean
  onClick: () => void
  small?: boolean
  title?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      className={joinClasses(
        'Button__root',
        disabled != null && 'Button__disabled',
        small != null && 'Button__small',
        className
      )}
      onClick={onClick}
      title={title}
      aria-label={title}
      {...(dataTestId != null && { 'data-test-id': dataTestId })}
    >
      {children}
    </button>
  )
}
