/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'

import { anthropicGenerationSchema } from './schema'
import { jsonSchemaFormat, readStructuredOutput } from './structured-output'

const message = (overrides: Partial<Anthropic.Message>): Anthropic.Message =>
  ({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content: [],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: {},
    ...overrides,
  }) as unknown as Anthropic.Message

const text = (value: string) =>
  ({ type: 'text', text: value, citations: null }) as Anthropic.TextBlock

describe('anthropic structured output', () => {
  it('builds a json_schema format without the draft-07 $schema keyword', () => {
    const format = jsonSchemaFormat(anthropicGenerationSchema)
    expect(format.type).toBe('json_schema')
    expect(format.schema).not.toHaveProperty('$schema')
    expect(format.schema).toHaveProperty('$defs')
  })

  it('parses the JSON object from the text blocks, ignoring thinking blocks', () => {
    const result = readStructuredOutput<{ edits: unknown[] }>(
      message({
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' } as Anthropic.ThinkingBlock,
          text('{"edits":'),
          text('[{"id":0,"text":"Le soleil brille"}]}'),
        ],
      })
    )
    expect(result).toEqual({ edits: [{ id: 0, text: 'Le soleil brille' }] })
  })

  it('throws on a refusal and names the category', () => {
    expect(() =>
      readStructuredOutput(
        message({
          stop_reason: 'refusal',
          stop_details: { type: 'refusal', category: 'cyber', explanation: null },
        } as Partial<Anthropic.Message>)
      )
    ).toThrow(/declined.*cyber/)
  })

  it('throws on a response truncated at max_tokens', () => {
    expect(() =>
      readStructuredOutput(message({ stop_reason: 'max_tokens', content: [text('{"edits":[')] }))
    ).toThrow(/truncated/)
  })

  it('throws when no text block is present', () => {
    expect(() => readStructuredOutput(message({}))).toThrow(/did not return a structured payload/)
  })

  it('throws when the text is not a JSON object', () => {
    expect(() => readStructuredOutput(message({ content: [text('not json')] }))).toThrow(
      /not valid JSON/
    )
    expect(() => readStructuredOutput(message({ content: [text('[1,2]')] }))).toThrow(
      /not a JSON object/
    )
  })
})
