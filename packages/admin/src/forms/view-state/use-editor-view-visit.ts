/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useState } from 'react'

import { createEditorViewStateStore, type EditorViewStateStore } from './editor-view-state.js'

/**
 * Owns the in-memory view-state store for one editing visit. The host supplies
 * the identity (for example `collection/<path>/<id>` or `singleton/<path>`).
 * The host's editor route survives save navigations and locale switches (which
 * remount the editor view), so the store lives with the route. A different
 * identity starts a new visit and a new store.
 *
 * The swap happens during render ("adjusting state when a prop changes"), so a
 * StrictMode double render settles on one store per identity.
 */
export function useEditorViewVisit(identity: string): EditorViewStateStore {
  const [visit, setVisit] = useState(() => ({ identity, store: createEditorViewStateStore() }))
  if (visit.identity === identity) return visit.store
  const next = { identity, store: createEditorViewStateStore() }
  setVisit(next)
  return next.store
}
