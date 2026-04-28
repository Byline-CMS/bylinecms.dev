/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type * as React from 'react'
import { useEffect } from 'react'

import { registerCodeHighlighting } from '@lexical/code'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'

export function CodeHighlightPlugin(): React.JSX.Element | null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return registerCodeHighlighting(editor)
  }, [editor])

  return null
}
