'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * The row of page-level controls sitting between the breadcrumb trail and a
 * document's title: "Copy page" on the left, the "On this page" sheet trigger
 * on the right.
 *
 * One row serves both layouts. On wide viewports `DocsTocSheet` hides its own
 * trigger (the contents are in the rail by then) and the row's alignment
 * switches so "Copy page" finishes on the right.
 */

import type React from 'react'

import cx from 'classnames'

import { CopyPageButton } from './copy-page-button'
import styles from './page-utilities.module.css'
import { DocsTocSheet } from './toc-sheet'
import type { TocHeading } from '@/modules/docs/toc'

interface DocsPageUtilitiesProps {
  markdownPath: string
  headings: TocHeading[]
  labels: {
    copyPage: string
    copied: string
    failed: string
    viewAsMarkdown: string
    onThisPage: string
  }
}

export function DocsPageUtilities({
  markdownPath,
  headings,
  labels,
}: DocsPageUtilitiesProps): React.JSX.Element {
  return (
    <div className={cx('byline-docs-page-utilities', styles.row)}>
      <CopyPageButton markdownPath={markdownPath} labels={labels} />
      <DocsTocSheet headings={headings} label={labels.onThisPage} />
    </div>
  )
}
