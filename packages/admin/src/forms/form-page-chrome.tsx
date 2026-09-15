'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Page-level chrome for the full-page document editor: the parts that frame a
 * form rather than render it. The embedded creation view renders none of this.
 *
 * Each component takes only the props it needs — deliberately not a
 * `FormRendererProps` pass-through, so what a region actually depends on stays
 * visible at its call site.
 */

import type { ReactNode } from 'react'

import cx from 'clsx'

import styles from './form-renderer.module.css'

export interface FormHeadingRowProps {
  heading: ReactNode
  /** Host-supplied controls rendered beside the heading (locale switcher, …). */
  headerSlot?: ReactNode
}

export const FormHeadingRow = ({ heading, headerSlot }: FormHeadingRowProps): ReactNode => (
  <div className={cx('byline-form-heading-row', styles['heading-row'])}>
    <h1 className={cx('byline-form-heading', styles.heading)}>{heading}</h1>
    {/* Source-locale anchor indicator removed pending heading-layout work.
        To re-enable: render `<SourceLocaleBadge locale={sourceLocale} />`
        here from `initialData.sourceLocale` (mismatch-only is the intended
        end state). See docs/08-internationalization/index.md. */}
    {headerSlot}
  </div>
)
