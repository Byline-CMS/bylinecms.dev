/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createContext, useContext } from 'react'

import type { EditorViewStateStore } from './editor-view-state'

/**
 * The per-visit view-state store, or `null` when the surrounding form has none
 * (create views and nested forms). Consumers must tolerate `null`.
 */
export const EditorViewStateContext = createContext<EditorViewStateStore | null>(null)

export function useEditorViewState(): EditorViewStateStore | null {
  return useContext(EditorViewStateContext)
}
