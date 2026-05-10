/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Admin-only AI server functions backing the `@byline/ai` plugins.
 *
 * The plugins use a `fetch`-shaped API; the host adapter ships a
 * `aiFetchAdapter` in `@byline/host-tanstack-start/integrations/byline-ai`
 * that wraps `executeAiInstruction` so the plugins remain transport-agnostic.
 */

export { executeAiInstruction } from './execute'
