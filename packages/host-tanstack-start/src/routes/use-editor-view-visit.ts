/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useState } from 'react'

import { createEditorViewStateStore, type EditorViewStateStore } from '@byline/admin/react'

/**
 * Owns the in-memory view-state store for one editing visit, identified by
 * `collection/<path>/<id>` or `singleton/<path>`. The route component survives
 * save navigations and locale switches (which remount the editor view), so the
 * store lives here. A different identity starts a new visit and a new store.
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
