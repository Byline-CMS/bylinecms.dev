/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { PROVIDERS, type Provider } from '@byline/ai'

const STORAGE_KEY = 'editor-chat-configuration'

export interface ChatConfiguration {
  mode: 'new' | 'new_with_context' | 'patch'
  provider: Provider
  model: string
}

const isChatConfiguration = (value: unknown): value is ChatConfiguration => {
  if (value == null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.mode === 'string' &&
    ['new', 'new_with_context', 'patch'].includes(v.mode) &&
    typeof v.provider === 'string' &&
    PROVIDERS.some((p) => p[0] === v.provider) &&
    typeof v.model === 'string'
  )
}

export const saveChatConfiguration = (config: ChatConfiguration) => {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch (error) {
    console.warn('Failed to save chat configuration:', error)
  }
}

export const loadChatConfiguration = (): ChatConfiguration | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isChatConfiguration(parsed) ? parsed : null
  } catch (error) {
    console.warn('Failed to load chat configuration:', error)
    return null
  }
}

export const clearChatConfiguration = () => {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (error) {
    console.warn('Failed to clear chat configuration:', error)
  }
}
