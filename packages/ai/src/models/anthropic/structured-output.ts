/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type Anthropic from '@anthropic-ai/sdk'

/**
 * Builds an `output_config.format` value from a JSON schema. Anthropic's
 * structured outputs constrain the response text to the schema, which works
 * on every current Claude model — unlike a forced `tool_choice`, which Claude
 * Opus 5.5, Sonnet 5.5 and Fable 5.1 reject with a 400.
 */
export const jsonSchemaFormat = (schema: Record<string, unknown>): Anthropic.JSONOutputFormat => {
  // Anthropic does not need the draft-07 $schema keyword.
  const { $schema: _ignored, ...rest } = schema
  return { type: 'json_schema', schema: rest }
}

/**
 * Reads the JSON object a structured-output response carries in its text
 * blocks. A refusal, a truncated response, an empty response or text that is
 * not a JSON object is an explicit error rather than a silently missing value.
 */
export const readStructuredOutput = <T extends object>(message: Anthropic.Message): T => {
  if (message.stop_reason === 'refusal') {
    const category = message.stop_details?.category
    throw new Error(
      category != null
        ? `Anthropic declined the request (refusal category: ${category}).`
        : 'Anthropic declined the request.'
    )
  }

  if (message.stop_reason === 'max_tokens') {
    throw new Error('Anthropic response was truncated at max_tokens before the JSON was complete.')
  }

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()

  if (text.length === 0) {
    throw new Error('Anthropic did not return a structured payload.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`Anthropic returned a payload that is not valid JSON. Text: ${text}`)
  }

  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Anthropic returned a payload that is not a JSON object. Text: ${text}`)
  }

  return parsed as T
}
