'use client'

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type * as React from 'react'

import { ContentEditable as LexicalContentEditable } from '@lexical/react/LexicalContentEditable'
import cx from 'classnames'

import { useEditorConfig } from './config/editor-config-context'

import './content-editable.css'

export function ContentEditable({ className }: { className?: string }): React.JSX.Element {
  const { config } = useEditorConfig()
  // const classes = cx('ContentEditable__root', className, {
  //   ContentEditable__with_draggable_blocks: config.options.draggableBlocks
  // })
  const classes = cx('ContentEditable__root', className)

  return <LexicalContentEditable className={classes} />
}
