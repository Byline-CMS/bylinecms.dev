'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 *
 * Portions Copyright (c) Meta Platforms, Inc. and affiliates.
 */

import type * as React from 'react'

import { ReactExtension } from '@lexical/react/ReactExtension'
import { configExtension, defineExtension } from 'lexical'

import {
  createLinkMatcherWithRegExp,
  AutoLinkPlugin as LexicalAutoLinkPlugin,
} from './auto-link-plugin'

const URL_REGEX =
  /((https?:\/\/(www\.)?)|(www\.))[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/

const EMAIL_REGEX =
  /(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))/

const MATCHERS = [
  createLinkMatcherWithRegExp(URL_REGEX, (text) => {
    return text.startsWith('http') ? text : `https://${text}`
  }),
  createLinkMatcherWithRegExp(EMAIL_REGEX, (text) => {
    return `mailto:${text}`
  }),
]

export function AutoLinkPlugin(): React.JSX.Element {
  return <LexicalAutoLinkPlugin matchers={MATCHERS} />
}

export const AutoLinkExtension = defineExtension({
  name: '@byline/richtext-lexical/AutoLink',
  dependencies: [configExtension(ReactExtension, { decorators: [<AutoLinkPlugin key="d" />] })],
})
