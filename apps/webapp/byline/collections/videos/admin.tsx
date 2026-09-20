/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { DateTimeFormatter } from '@byline/admin/react'
import { type CollectionAdminConfig, type ColumnDefinition, defineAdmin } from '@byline/core'

import { VideoPosterThumbnail } from './components/video-poster-thumbnail.js'
import { Videos } from './schema.js'

/**
 * Both views lead with the poster: `alt` is the title field, but a thumbnail
 * identifies a video far faster than its alt text — particularly in the
 * relation picker that `videoBlock` opens.
 */
const previewColumn: ColumnDefinition = {
  fieldName: 'poster' as keyof any,
  label: 'Preview',
  align: 'left',
  className: 'w-[5%]',
  formatter: { component: VideoPosterThumbnail },
}

const listViewColumns: ColumnDefinition[] = [
  previewColumn,
  {
    fieldName: 'alt',
    label: 'Alt Text',
    sortable: true,
    align: 'left',
    className: 'w-[60%]',
  },
  {
    fieldName: 'status',
    label: 'Status',
    align: 'center',
    className: 'w-[15%]',
  },
  {
    fieldName: 'updatedAt',
    label: 'Last Updated',
    sortable: true,
    align: 'right',
    className: 'w-[20%]',
    formatter: { component: DateTimeFormatter },
  },
]

const itemViewColumns: ColumnDefinition[] = [
  previewColumn,
  {
    fieldName: 'alt',
    label: 'Alt Text',
    align: 'left',
    className: 'flex-1',
  },
]

export const VideosAdmin: CollectionAdminConfig = defineAdmin(Videos, {
  /** Dashboard group — see `collectionGroups` in `byline/admin.config.ts`. */
  group: 'media',
  columns: listViewColumns,
  itemView: itemViewColumns,
  itemViewSort: { field: 'alt', direction: 'asc' },
})
