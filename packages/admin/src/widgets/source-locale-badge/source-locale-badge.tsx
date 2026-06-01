/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { Badge } from '@byline/ui/react'
import cx from 'classnames'

import styles from './source-locale-badge.module.css'

export interface SourceLocaleBadgeProps {
  /** The document's content source locale code (e.g. `en`, `fr`). */
  locale: string
  className?: string
}

/**
 * Small neutral badge indicating a document's content **source locale** — the
 * locale it was authored in (its anchor: fallback floor, path locale,
 * completeness yardstick). Rendered next to the document title in the edit and
 * list views. Mirrors the localized-field {@link LocaleBadge} in spirit but uses
 * the shared {@link Badge} with the `noeffect` (neutral) intent.
 *
 * NOTE: currently rendered for *every* document so the anchor is visible during
 * development. The intended end state is to show it only when `locale` differs
 * from the system's current default content locale (a normal single-default
 * install then shows nothing). See docs/I18N.md.
 *
 * Stable override handle: `.byline-source-locale-badge`.
 */
export const SourceLocaleBadge = ({ locale, className }: SourceLocaleBadgeProps) => (
  <Badge
    intent="noeffect"
    render={<span />}
    title={`Primary content language: ${locale.toUpperCase()}`}
    className={cx('byline-source-locale-badge', styles.badge, className)}
  >
    {locale.toUpperCase()}
  </Badge>
)

SourceLocaleBadge.displayName = 'SourceLocaleBadge'
