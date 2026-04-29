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

import './content-editable.css'

// TODO: implement an inline version of content editable for
// image captions that will not allow inserted paragraphs.
// NOTE: we disable all config checks and draggable blocks
// as in content-editable.tsx - because this version will
// appear inside caption areas for images.
export default function ContentEditableInline({
  className,
}: {
  className?: string
}): React.JSX.Element {
  const classes = cx(className)
  return <LexicalContentEditable className={classes} />
}
