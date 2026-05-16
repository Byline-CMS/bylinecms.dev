/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { declarePeerDependency, defineExtension } from 'lexical'

import {
  type BylineFloatingUIConfig,
  BylineFloatingUIExtension,
} from '../byline-floating-ui/byline-floating-ui-extension'
import { FloatingTextFormatToolbarPlugin } from './index'

/**
 * Standalone Byline extension that contributes the floating text-format
 * toolbar (the popover shown above a non-collapsed range selection) to
 * the editor. Removing this extension from the registered list hides the
 * UI — `c.extensions.remove(FloatingTextFormatExtension)`.
 *
 * Lives in its own extension because the popover isn't owned by any
 * single feature: it handles bold / italic / underline / strikethrough /
 * subscript / superscript / inline-code / link toggle in one place.
 */
export const FloatingTextFormatExtension = defineExtension({
  name: '@byline/richtext-lexical/FloatingTextFormat',
  peerDependencies: [
    declarePeerDependency<typeof BylineFloatingUIExtension>(BylineFloatingUIExtension.name, {
      items: [
        {
          id: '@byline/richtext-lexical/FloatingTextFormat/popover',
          Component: FloatingTextFormatToolbarPlugin,
        },
      ],
    } satisfies Partial<BylineFloatingUIConfig>),
  ],
})
