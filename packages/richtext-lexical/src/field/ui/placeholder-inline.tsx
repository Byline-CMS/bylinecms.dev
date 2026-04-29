'use client'

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type * as React from 'react'

import cx from 'classnames'

import './placeholder.css'

// NOTE: we disable all config checks and draggable blocks
// as in placeholder.tsx - because this version will
// appear inside caption areas for images.
export default function PlaceholderInline({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  const classes = cx('Placeholder__root', className)
  return <span className={classes}>{children}</span>
}
