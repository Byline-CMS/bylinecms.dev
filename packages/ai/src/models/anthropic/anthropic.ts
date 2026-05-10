/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { createAnthropic } from '@ai-sdk/anthropic'

const normalizeAnthropicBaseURL = (value: string | undefined) => {
  const base = (value && value.trim().length > 0 ? value : 'https://api.anthropic.com')
    .trim()
    .replace(/\/+$/, '')

  // The Vercel AI SDK Anthropic provider expects baseURL that includes `/v1`.
  return base.endsWith('/v1') ? base : `${base}/v1`
}

export const anthropic = (apiKey: string) =>
  createAnthropic({
    apiKey,
    baseURL: normalizeAnthropicBaseURL(process.env.ANTHROPIC_BASE_URL),
  })
