/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import cx from 'classnames'

import styles from './branding.module.css'
import Logo from './byline-logo.js'
import { Link } from './loose-router.js'

export function Branding() {
  return (
    <div className={cx('byline-admin-branding', styles.root)}>
      <Link to={'/' as never}>
        <Logo className={cx('byline-admin-branding-logo', styles.logo)} />
      </Link>
    </div>
  )
}
