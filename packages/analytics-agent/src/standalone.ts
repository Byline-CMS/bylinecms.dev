/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { analyticsAgentConfigFromScript, installAnalyticsAgent } from './index.js'

try {
  const config = analyticsAgentConfigFromScript(document.currentScript as HTMLScriptElement)
  if (config != null) installAnalyticsAgent(config)
} catch {
  // Loading analytics must never affect the host page.
}
