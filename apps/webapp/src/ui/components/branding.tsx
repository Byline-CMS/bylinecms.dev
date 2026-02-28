/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { LangLink } from '@/i18n/components/lang-link'
import Logo from '@/images/byline-logo'
// import logo from '../../images/byline-logo.svg'

export function Branding() {
  return (
    <div className="flex items-center space-x-2">
      <LangLink to="/">
        <Logo className="w-[24px] h-[24px]" />
      </LangLink>
    </div>
  )
}
