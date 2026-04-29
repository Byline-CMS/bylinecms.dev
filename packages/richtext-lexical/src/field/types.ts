/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type { EditorState, LexicalEditor } from 'lexical'

import type { EditorSettings } from './config/types'

export interface OnChangeProps {
  onChange: (editorState: EditorState, editor: LexicalEditor, tags: Set<string>) => void
  initialJSON: any
  config: EditorSettings
  value: any
  setValue: (value: any) => void
}
