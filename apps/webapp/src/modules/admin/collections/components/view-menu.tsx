/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { useNavigate } from '@tanstack/react-router'

import { Button, HistoryIcon, IconButton } from '@infonomic/uikit/react'

export type ViewMenuPaths = 'edit' | 'history' | 'api'

/**
 * Shared mini-navigation bar for document-level views (Edit, History, API).
 * Renders the History icon button, Edit button, and API button with
 * appropriate variant styling based on the currently active view.
 */
export const ViewMenu = ({
  collection,
  documentId,
  activeView,
}: {
  /** Collection path (e.g. "docs", "news"). */
  collection: string
  /** The document ID to navigate to. */
  documentId: string
  /** Which view is currently active — used to style the active button. */
  activeView?: ViewMenuPaths
}) => {
  const navigate = useNavigate()

  return (
    <div className="flex items-center gap-2">
      <IconButton
        className="min-w-[24px] min-h-[24px]"
        size="sm"
        variant="text"
        onClick={() =>
          navigate({
            to: '/admin/collections/$collection/$id/history',
            params: { collection, id: documentId },
          })
        }
      >
        <HistoryIcon className="w-5 h-5" />
      </IconButton>
      <Button
        size="sm"
        variant={activeView === 'edit' ? 'filled' : 'outlined'}
        className="min-w-[50px] min-h-[28px]"
        onClick={() =>
          navigate({
            to: '/admin/collections/$collection/$id',
            params: { collection, id: documentId },
          })
        }
      >
        Edit
      </Button>
      <Button
        size="sm"
        variant={activeView === 'api' ? 'filled' : 'outlined'}
        className="min-w-[50px] min-h-[28px]"
        onClick={() =>
          navigate({
            to: '/admin/collections/$collection/$id/api',
            params: { collection, id: documentId },
          })
        }
      >
        API
      </Button>
    </div>
  )
}
